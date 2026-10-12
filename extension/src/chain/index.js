// Nadeye chain client: burner wallet, batched attestations, registry
// lookups. Storage is injected ({get(keys) -> Promise<obj>, set(obj)}) so the
// same code runs in the MV3 service worker (chrome.storage.local) and in Node
// tests against a local anvil node.
//
// Bundled with viem into src/chain.bundle.js by build.mjs.

import { createPublicClient, createWalletClient, http, formatEther, isAddress, zeroAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { nadeyeAbi } from "./abi.js";
import { parseAbi } from "viem";

const reputationAbi = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);
import { NETWORKS, MAX_BATCH, AUTO_FLUSH_AT, GAS_BUFFER, LEADERBOARD_URL, SITE_ORIGINS, isRecordable } from "./config.js";

export { NETWORKS, AUTO_FLUSH_AT, SITE_ORIGINS };

const SEEN_MAX = 5000;

export function createChain({ store, network = "testnet", override = null }) {
  const net = { ...NETWORKS[network], ...(override || {}) };
  if (!net.chain) throw new Error(`unknown network ${network}`);
  const transport = http(net.rpcUrl, { batch: { wait: 20 }, retryCount: 2 });
  const pub = createPublicClient({ chain: net.chain, transport });
  const contract = net.contract;
  const qKey = `ppQueue:${network}`;
  const seenKey = `ppSeen:${network}`;
  const lastKey = `ppLastTx:${network}`;

  const configured = () => isAddress(contract) && contract !== zeroAddress;

  async function account() {
    let { ppKey } = await store.get(["ppKey"]);
    if (!ppKey) {
      ppKey = generatePrivateKey();
      await store.set({ ppKey });
    }
    return privateKeyToAccount(ppKey);
  }

  /** registry lookup for many pHash keys in one eth_call */
  async function lookup(keys) {
    if (!configured() || keys.length === 0) return {};
    const rows = await pub.readContract({ address: contract, abi: nadeyeAbi, functionName: "getImages", args: [keys] });
    const out = {};
    rows.forEach((r, i) => {
      out[keys[i]] = { reports: r.reports, aiVotes: r.aiVotes, meanScore: r.meanScore / 10000 };
    });
    return out;
  }

  /** queue verdicts ({key, score 0..1}); returns the queue length */
  async function enqueue(items) {
    const d = await store.get([qKey, seenKey]);
    const queue = d[qKey] || [];
    const seen = new Set(d[seenKey] || []);
    const inQueue = new Set(queue.map((q) => q.k));
    for (const { key, score } of items) {
      if (!key || /^0x0+$/.test(key) || seen.has(key) || inQueue.has(key)) continue;
      const s = Math.max(0, Math.min(10000, Math.round(score * 10000)));
      if (!isRecordable(s)) continue; // unsure band: not an onchain vote
      queue.push({ k: key, s });
      inQueue.add(key);
    }
    await store.set({ [qKey]: queue });
    return queue.length;
  }

  let flushing = null;
  /** send up to MAX_BATCH queued verdicts in one attestBatch transaction */
  function flush(modelVersion = 0) {
    if (!flushing) flushing = doFlush(modelVersion).finally(() => (flushing = null));
    return flushing;
  }

  async function doFlush(modelVersion) {
    if (!configured()) return { sent: 0, reason: "contract-not-configured" };
    const d = await store.get([qKey, seenKey]);
    const queue = d[qKey] || [];
    if (queue.length === 0) return { sent: 0, reason: "empty" };
    const acct = await account();
    const balance = await pub.getBalance({ address: acct.address });
    if (balance === 0n) return { sent: 0, reason: "no-gas", address: acct.address };

    const batch = queue.slice(0, MAX_BATCH);
    const args = [batch.map((b) => b.k), batch.map((b) => b.s), modelVersion & 0xff];
    const { request } = await pub.simulateContract({
      account: acct, address: contract, abi: nadeyeAbi, functionName: "attestBatch", args,
    });
    const est = await pub.estimateContractGas({
      account: acct, address: contract, abi: nadeyeAbi, functionName: "attestBatch", args,
    });
    const wallet = createWalletClient({ account: acct, chain: net.chain, transport });
    const hash = await wallet.writeContract({ ...request, gas: (est * BigInt(Math.round(GAS_BUFFER * 100))) / 100n });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status !== "success") return { sent: 0, reason: "reverted", hash };

    // drop what was sent; anything enqueued meanwhile is kept
    const now = await store.get([qKey, seenKey]);
    const sentKeys = new Set(batch.map((b) => b.k));
    const rest = (now[qKey] || []).filter((q) => !sentKeys.has(q.k));
    const seen = [...(now[seenKey] || []), ...sentKeys].slice(-SEEN_MAX);
    await store.set({ [qKey]: rest, [seenKey]: seen, [lastKey]: { hash, at: Date.now(), n: batch.length } });
    return { sent: batch.length, hash, remaining: rest.length };
  }

  /** wallet, balance, queue and leaderboard stats for the popup */
  async function status() {
    const acct = await account();
    const d = await store.get([qKey, lastKey]);
    const base = {
      network, label: net.label, address: acct.address, configured: configured(),
      queued: (d[qKey] || []).length, lastTx: d[lastKey] || null,
      explorer: net.explorer, faucet: net.faucet, leaderboard: LEADERBOARD_URL, contract,
    };
    try {
      const [bal, me] = await Promise.all([
        pub.getBalance({ address: acct.address }),
        configured()
          ? pub.readContract({ address: contract, abi: nadeyeAbi, functionName: "getScanner", args: [acct.address] })
          : null,
      ]);
      base.balance = formatEther(bal);
      if (me) {
        const judged = me.signal + me.noise;
        base.me = {
          handle: me.handle, points: Number(me.points), scans: me.scans, firsts: me.firsts,
          activeDays: me.activeDays, snr: judged ? (100 * me.signal) / judged : null,
          agentId: me.hasAgent ? me.agentId.toString() : null,
        };
        if (me.hasAgent && net.reputation) {
          try {
            const [count, value, decimals] = await pub.readContract({
              address: net.reputation, abi: reputationAbi, functionName: "getSummary",
              args: [me.agentId, [contract], "nadeye", "consensus"],
            });
            base.me.reputation = { count: Number(count), agreement: count ? Number(value) / 10 ** decimals : null };
          } catch {}
        }
      }
    } catch (e) {
      base.error = String(e?.shortMessage || e?.message || e);
    }
    return base;
  }

  async function setHandle(handle) {
    const acct = await account();
    const wallet = createWalletClient({ account: acct, chain: net.chain, transport });
    const args = [String(handle).replace(/^@/, "").slice(0, 32)];
    const est = await pub.estimateContractGas({ account: acct, address: contract, abi: nadeyeAbi, functionName: "setHandle", args });
    const hash = await wallet.writeContract({
      address: contract, abi: nadeyeAbi, functionName: "setHandle", args,
      gas: (est * BigInt(Math.round(GAS_BUFFER * 100))) / 100n,
    });
    await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
    return hash;
  }

  async function exportKey() {
    await account();
    return (await store.get(["ppKey"])).ppKey;
  }

  async function importKey(pk) {
    const acct = privateKeyToAccount(pk); // throws on garbage
    await store.set({ ppKey: pk });
    return acct.address;
  }

  return { lookup, enqueue, flush, status, setHandle, exportKey, importKey, account, configured, net };
}
