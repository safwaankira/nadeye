// nadeye-sdk: read Nadeye's image-provenance registry on Monad from any app or agent.
//
//   import { createNadeyeClient } from "nadeye-sdk";
//   const nadeye = createNadeyeClient({ network: "testnet", nadeye: "0x…", passkeys: "0x…" });
//   const r = await nadeye.lookupImage(imageData);   // { pHash, verdict, reports, aiVotes, … }
//
// Reads only: no keys, no gas. Writing verdicts is the extension's and the agent's job.
import { createPublicClient, http } from "viem";
import { monad, monadTestnet } from "viem/chains";
import { pHashDetail, lookupCandidates, toKey } from "./phash.js";

export { pHash64, pHashDetail, lookupCandidates, toKey, hamming } from "./phash.js";

export const NETWORKS = {
  testnet: {
    chain: monadTestnet, rpcUrl: "https://testnet-rpc.monad.xyz",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713", validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
  mainnet: {
    chain: monad, rpcUrl: "https://rpc.monad.xyz",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63", validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
  },
};

/** onchain vote bands (Nadeye.sol): an AI vote is a score >= 8000, a real vote < 5000 basis points */
export const AI_VOTE_BPS = 8000;
export const REAL_VOTE_BELOW_BPS = 5000;

const imageView = { type: "tuple", components: [
  { name: "pHash", type: "bytes32" }, { name: "reports", type: "uint32" }, { name: "aiVotes", type: "uint32" },
  { name: "meanScore", type: "uint16" }, { name: "firstScanner", type: "address" }, { name: "firstSeen", type: "uint40" },
  { name: "lastSeen", type: "uint40" } ] };
export const nadeyeAbi = [
  { type: "function", name: "getImages", stateMutability: "view", inputs: [{ name: "pHashes", type: "bytes32[]" }], outputs: [{ ...imageView, type: "tuple[]" }] },
  { type: "function", name: "stats", stateMutability: "view", inputs: [], outputs: [
    { name: "scans", type: "uint256" }, { name: "images", type: "uint256" }, { name: "scanners", type: "uint256" }, { name: "flagged", type: "uint256" }] },
  { type: "function", name: "getScanner", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "account", type: "address" }, { name: "handle", type: "string" }, { name: "points", type: "uint64" }, { name: "scans", type: "uint32" },
    { name: "firsts", type: "uint32" }, { name: "signal", type: "uint32" }, { name: "noise", type: "uint32" }, { name: "activeDays", type: "uint32" },
    { name: "joined", type: "uint40" }, { name: "hasAgent", type: "bool" }, { name: "agentId", type: "uint256" }] }] },
];
const passkeysAbi = [
  { type: "function", name: "hasPasskeys", stateMutability: "view", inputs: [{ name: "accounts", type: "address[]" }], outputs: [{ type: "bool[]" }] },
];
const reputationAbi = [
  { type: "function", name: "getSummary", stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }, { name: "clientAddresses", type: "address[]" }, { name: "tag1", type: "string" }, { name: "tag2", type: "string" }],
    outputs: [{ name: "count", type: "uint64" }, { name: "summaryValue", type: "int128" }, { name: "summaryValueDecimals", type: "uint8" }] },
];

/**
 * Merge registry rows (the exact hash and its near variants) into one community verdict.
 * verdict: "none" (nobody recorded it), "ai" (more than half AI votes), "real", or "split" (a tie).
 */
export function communityVerdict(rows) {
  let reports = 0, aiVotes = 0, weighted = 0;
  for (const r of rows) {
    const n = Number(r.reports);
    reports += n; aiVotes += Number(r.aiVotes); weighted += Number(r.meanScore) * n;
  }
  const verdict = reports === 0 ? "none" : aiVotes * 2 === reports ? "split" : aiVotes * 2 > reports ? "ai" : "real";
  return { verdict, reports, aiVotes, aiShare: reports ? aiVotes / reports : null, meanScore: reports ? weighted / reports / 10000 : null };
}

/**
 * @param {object} o
 * @param {"testnet"|"mainnet"} [o.network]  defaults to testnet
 * @param {string} o.nadeye      Nadeye contract address
 * @param {string} [o.passkeys]  PasskeyRegistry address, for passkey checks
 * @param {string} [o.rpcUrl]    overrides the network's public RPC
 * @param {object} [o.chain]     a viem chain, for local or custom deployments
 * @param {string} [o.agentUrl]  a Nadeye verifier agent's HTTP base URL, for verifyUrl()
 */
export function createNadeyeClient({ network = "testnet", nadeye, passkeys = null, rpcUrl, chain, agentUrl = null }) {
  const net = NETWORKS[network];
  if (!net && !chain) throw new Error(`network must be testnet or mainnet, got ${network}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(nadeye || "")) throw new Error("pass the Nadeye contract address as `nadeye`");
  const pub = createPublicClient({ chain: chain || net.chain, transport: http(rpcUrl || net?.rpcUrl) });
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

  /** community verdict for 16-hex-char pHashes (one image's hash and its near variants) */
  async function lookupHashes(hashes) {
    const list = [].concat(hashes);
    if (!list.every((h) => /^(0x)?[0-9a-fA-F]{16}$/.test(h))) throw new Error("pHashes are 16 hex characters");
    const rows = await read(nadeye, nadeyeAbi, "getImages", [list.map((h) => toKey(h.replace(/^0x/, "")))]);
    return communityVerdict(rows);
  }

  /** hash decoded pixels ({ data, width, height }, e.g. canvas ImageData) and look them up,
   *  including the 36 nearest variants so resized or recompressed copies still match */
  async function lookupImage(imageData) {
    const detail = pHashDetail(imageData);
    const candidates = lookupCandidates(detail);
    return { pHash: detail.hex, candidates: candidates.length, ...(await lookupHashes(candidates)) };
  }

  async function stats() {
    const [scans, images, scanners, flagged] = await read(nadeye, nadeyeAbi, "stats");
    return { scans: Number(scans), images: Number(images), scanners: Number(scanners), flagged: Number(flagged) };
  }

  /** a scanner's record, plus whether it proved a passkey onchain (when `passkeys` is set) */
  async function scanner(address) {
    const s = await read(nadeye, nadeyeAbi, "getScanner", [address]);
    const judged = s.signal + s.noise;
    return {
      account: s.account, handle: s.handle, points: Number(s.points), scans: s.scans, firsts: s.firsts,
      signalToNoise: judged ? s.signal / judged : null, activeDays: s.activeDays,
      agentId: s.hasAgent ? s.agentId : null, passkey: passkeys ? (await hasPasskeys([address]))[0] : null,
    };
  }

  async function hasPasskeys(addresses) {
    if (!passkeys) throw new Error("pass the PasskeyRegistry address as `passkeys`");
    return read(passkeys, passkeysAbi, "hasPasskeys", [addresses]);
  }

  /** an ERC-8004 agent's Nadeye track record: how often its verdicts agreed with consensus */
  async function reputation(agentId) {
    if (!net) throw new Error("reputation() needs network testnet or mainnet");
    const [count, value, decimals] = await read(net.reputation, reputationAbi, "getSummary", [BigInt(agentId), [nadeye], "nadeye", "consensus"]);
    return { judged: Number(count), agreement: count ? Number(value) / 10 ** decimals / 100 : null };
  }

  /** ask a Nadeye verifier agent to score an image URL (runs the detector there) */
  async function verifyUrl(imageUrl) {
    if (!agentUrl) throw new Error("pass the verifier agent's URL as `agentUrl`");
    const r = await fetch(`${agentUrl.replace(/\/$/, "")}/verify?url=${encodeURIComponent(imageUrl)}`);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `agent answered HTTP ${r.status}`);
    return body;
  }

  return { lookupHashes, lookupImage, stats, scanner, hasPasskeys, reputation, verifyUrl, publicClient: pub };
}
