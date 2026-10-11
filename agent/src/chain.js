// Monad side of the agent: PixelProof registry + the ERC-8004 registries.
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const pixelProofAbi = parseAbi([
  "struct ImageView { bytes32 pHash; uint32 reports; uint32 aiVotes; uint16 meanScore; address firstScanner; uint40 firstSeen; uint40 lastSeen; }",
  "struct ScannerView { address account; string handle; uint64 points; uint32 scans; uint32 firsts; uint32 signal; uint32 noise; uint32 activeDays; uint40 joined; bool hasAgent; uint256 agentId; }",
  "function getImages(bytes32[] pHashes) view returns (ImageView[])",
  "function getScanner(address account) view returns (ScannerView)",
  "function hasAttested(bytes32 pHash, address scanner) view returns (bool)",
  "function attest(bytes32 pHash, uint16 score, uint8 modelVersion)",
  "function linkAgent(uint256 agentId)",
  "function setHandle(string handle)",
]);

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const validationAbi = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
  "function getValidatorRequests(address validatorAddress) view returns (bytes32[])",
  "event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)",
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
]);

export const reputationAbi = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

export const VALIDATION_TAG = "pixelproof/ai-image";
export const GAS_BUFFER_PCT = 115n; // Monad bills the gas limit: pad estimates lightly

// 8-bit fingerprint of the weights version, identical to the extension's
export function modelVersionByte(version) {
  let h = 0x811c9dc5;
  for (const c of version) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h & 0xff;
}

export const toKey = (hex) => "0x" + hex.padStart(64, "0");

export function createChainClient(cfg) {
  const transport = http(cfg.rpcUrl, { batch: { wait: 10 }, retryCount: 2 });
  const pub = createPublicClient({ chain: cfg.chain, transport });
  const account = cfg.privateKey ? privateKeyToAccount(cfg.privateKey) : null;
  const wallet = account ? createWalletClient({ account, chain: cfg.chain, transport }) : null;

  async function send(address, abi, functionName, args) {
    if (!wallet) throw new Error("AGENT_PRIVATE_KEY is not set");
    const gas = await pub.estimateContractGas({ account, address, abi, functionName, args });
    const hash = await wallet.writeContract({ address, abi, functionName, args, gas: (gas * GAS_BUFFER_PCT) / 100n });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return receipt;
  }

  /** community verdict for a hash and its near-variants, merged */
  async function community(keysHex) {
    if (!cfg.contract) return null;
    const rows = await pub.readContract({ address: cfg.contract, abi: pixelProofAbi, functionName: "getImages", args: [keysHex.map(toKey)] });
    let reports = 0, aiVotes = 0, sum = 0;
    for (const r of rows) { reports += r.reports; aiVotes += r.aiVotes; sum += r.meanScore * r.reports; }
    return reports ? { reports, aiVotes, meanScore: sum / reports / 10000 } : { reports: 0, aiVotes: 0, meanScore: null };
  }

  /** the agent records its own verdict as a PixelProof scanner (skips duplicates) */
  async function attest(phashHex, score, modelVersion) {
    if (!cfg.contract || !wallet || !cfg.attest) return null;
    const key = toKey(phashHex);
    if (await pub.readContract({ address: cfg.contract, abi: pixelProofAbi, functionName: "hasAttested", args: [key, account.address] })) return null;
    const r = await send(cfg.contract, pixelProofAbi, "attest", [key, Math.round(score * 10000), modelVersion]);
    return r.transactionHash;
  }

  async function register(agentURI) {
    const r = await send(cfg.identity, identityAbi, "register", [agentURI]);
    const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: r.logs });
    return { agentId: ev.args.agentId, hash: r.transactionHash };
  }

  const linkAgent = (agentId) => send(cfg.contract, pixelProofAbi, "linkAgent", [agentId]);
  const setHandle = (h) => send(cfg.contract, pixelProofAbi, "setHandle", [h]);

  async function reputation(agentId) {
    if (!cfg.contract || agentId == null) return null;
    const [count, value, decimals] = await pub.readContract({
      address: cfg.reputation, abi: reputationAbi, functionName: "getSummary",
      args: [agentId, [cfg.contract], "pixelproof", "consensus"],
    });
    return { count: Number(count), agreement: count ? Number(value) / 10 ** decimals : null };
  }

  return { pub, wallet, account, send, community, attest, register, linkAgent, setHandle, reputation };
}

export function reportHash(json) {
  return keccak256(toBytes(json));
}
export { toHex };
