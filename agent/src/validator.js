// ERC-8004 validator loop. Any agent owner can ask this verifier to check an
// image by calling ValidationRegistry.validationRequest(<this wallet>,
// <their agentId>, <image URL>, <requestHash>). The verifier scores the image
// and answers onchain with validationResponse:
//   response     = authenticity 0-100 (100 = no sign of AI, 0 = AI-generated)
//   responseURI  = data: JSON report      responseHash = keccak256(report)
//   tag          = "nadeye/ai-image"
// It also records its verdict in the Nadeye registry as a scanner.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { validationAbi, VALIDATION_TAG, reportHash } from "./chain.js";

const CHUNK = 100n; // public Monad RPCs cap eth_getLogs block ranges

export function createValidator({ cfg, chain, verifier, log = console.error }) {
  if (!chain.account) throw new Error("the validator needs AGENT_PRIVATE_KEY");
  const me = chain.account.address;
  const statePath = join(cfg.cacheDir, `validator-${cfg.network}-${me.toLowerCase()}.json`);
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { cursor: null, done: {}, failures: {} };
  state.deferred ||= {};
  const save = () => { mkdirSync(cfg.cacheDir, { recursive: true }); writeFileSync(statePath, JSON.stringify(state)); };
  // spend limits: anyone can address requests to this wallet, and each answer costs gas
  const maxPerHour = cfg.validatorMaxPerHour ?? 30;
  const minBalance = cfg.validatorMinBalanceWei ?? 0n;
  const recent = new Map(); // requesting agentId -> answer timestamps in the last hour
  let warnedLow = false;

  async function pending(requestHash) {
    const [validator, , , responseHash, tag] = await chain.pub.readContract({
      address: cfg.validation, abi: validationAbi, functionName: "getValidationStatus", args: [requestHash],
    });
    return validator.toLowerCase() === me.toLowerCase() && /^0x0+$/.test(responseHash) && tag === "";
  }

  async function handle({ requestHash, requestURI, agentId }) {
    if (state.done[requestHash]) return;
    if (!(await pending(requestHash))) { state.done[requestHash] = "answered"; delete state.deferred[requestHash]; save(); return; }
    const key = String(agentId), now = Date.now();
    const times = (recent.get(key) || []).filter((t) => now - t < 3_600_000);
    if (times.length >= maxPerHour) {
      state.done[requestHash] = `skipped: agent ${key} over ${maxPerHour} requests per hour`;
      log(`  skipped ${requestHash.slice(0, 10)}…: agent ${key} is over ${maxPerHour} requests per hour`);
      save(); return;
    }
    if (minBalance > 0n && (await chain.pub.getBalance({ address: me })) < minBalance) {
      state.deferred[requestHash] = { requestHash, requestURI, agentId: key }; // answered once the wallet is topped up
      if (!warnedLow) log(`  wallet ${me} is below the ${Number(minBalance) / 1e18} MON floor; deferring answers until it is topped up`);
      warnedLow = true; save(); return;
    }
    warnedLow = false;
    times.push(now); recent.set(key, times);
    delete state.deferred[requestHash];
    log(`validation request ${requestHash.slice(0, 10)}… from agent ${agentId}: ${requestURI.slice(0, 120)}`);
    let report;
    try {
      report = await verifier.verifyUrl(requestURI, { attest: true });
    } catch (e) {
      const n = (state.failures[requestHash] || 0) + 1;
      state.failures[requestHash] = n;
      log(`  could not verify (${e.message}); attempt ${n}/3`);
      if (n >= 3) state.done[requestHash] = `failed: ${e.message}`; // leave it unanswered rather than guess
      save();
      return;
    }
    const body = {
      verdict: report.verdict, aiConfidence: report.aiConfidence, authenticity: report.authenticity, evidence: report.evidence,
      degraded: report.degraded, pHash: report.pHash, community: report.community, model: report.model.version,
      source: requestURI.slice(0, 300), nadeye: cfg.contract,
    };
    const json = JSON.stringify(body);
    const responseURI = "data:application/json;base64," + Buffer.from(json).toString("base64");
    const r = await chain.send(cfg.validation, validationAbi, "validationResponse",
      [requestHash, report.authenticity, responseURI, reportHash(json), VALIDATION_TAG]);
    state.done[requestHash] = r.transactionHash;
    save();
    log(`  answered ${report.verdict} (authenticity ${report.authenticity}) in ${r.transactionHash}${report.attestTx ? `, attested ${report.attestTx}` : ""}`);
  }

  async function scan(from, to) {
    for (const d of Object.values(state.deferred)) {
      try { await handle({ ...d, agentId: BigInt(d.agentId) }); } catch (e) { log(`  failed to answer ${d.requestHash}: ${e.shortMessage || e.message}`); }
    }
    for (let a = from; a <= to; a += CHUNK) {
      const b = a + CHUNK - 1n > to ? to : a + CHUNK - 1n;
      const logs = await chain.pub.getContractEvents({
        address: cfg.validation, abi: validationAbi, eventName: "ValidationRequest",
        args: { validatorAddress: me }, fromBlock: a, toBlock: b,
      });
      for (const l of logs) {
        try { await handle(l.args); } catch (e) { log(`  failed to answer ${l.args.requestHash}: ${e.shortMessage || e.message}`); }
      }
      state.cursor = b.toString();
      save();
    }
  }

  async function run({ backfillBlocks = 3000n, pollMs = 2000, once = false } = {}) {
    let head = await chain.pub.getBlockNumber();
    let from = state.cursor ? BigInt(state.cursor) + 1n : head > backfillBlocks ? head - backfillBlocks : 0n;
    log(`Nadeye validator ${me} on ${cfg.network}, watching ValidationRegistry ${cfg.validation} from block ${from}`);
    const open = await chain.pub.readContract({ address: cfg.validation, abi: validationAbi, functionName: "getValidatorRequests", args: [me] });
    log(`${open.length} request(s) ever addressed to this validator`);
    for (;;) {
      head = await chain.pub.getBlockNumber();
      if (head >= from) { await scan(from, head); from = head + 1n; }
      if (once) return state;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  return { run, handle, state };
}
