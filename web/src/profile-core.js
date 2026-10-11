// "One passkey, many keys": everything PixelProof derives from a Mera passkey,
// and the onchain steps that turn it into an ERC-8004 identity. Pure functions
// over viem accounts, so the same code runs in the page and in Node tests.
//
//   m/44'/60'/0'/0/0  identity key  — owns the ERC-8004 agent NFT. Only ever
//                                     lives in page memory, inside a Mera
//                                     signing session that is ended after use.
//   m/44'/60'/0'/0/1  scanner key   — the hot key the extension signs
//                                     attestations with; registered as the
//                                     agent's agentWallet, so the identity key
//                                     can rotate it out if it ever leaks.
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, parseEther, bytesToHex } from "viem";

export const IDENTITY_INDEX = 0;
export const SCANNER_INDEX = 1;

export function recoveryPhrase(prfOutput) {
  return entropyToMnemonic(prfOutput, wordlist);
}

/** BIP-44 EVM key from passkey PRF output — Mera's documented derivation */
export function deriveEvmKey(prfOutput, index) {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${index}`);
  if (!node.privateKey) throw new Error("derivation produced no key");
  return node.privateKey;
}

export const keyHex = (bytes) => bytesToHex(bytes);

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
export const pixelProofAbi = parseAbi([
  "struct ScannerView { address account; string handle; uint64 points; uint32 scans; uint32 firsts; uint32 signal; uint32 noise; uint32 activeDays; uint40 joined; bool hasAgent; uint256 agentId; }",
  "function getScanner(address account) view returns (ScannerView)",
  "function linkAgent(uint256 agentId)",
  "function setHandle(string handle)",
]);
export const reputationAbi = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

const GAS_PAD = (g) => (g * 115n) / 100n; // Monad bills the gas limit

export function scannerCard({ chainId, identity, scanner, handle, agentId = null }) {
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: handle ? `PixelProof scanner @${handle}` : "PixelProof scanner",
    description: "Runs the PixelProof extension: detects AI-generated images on-device and attests verdicts to Monad. Reputation = agreement with the PixelProof consensus (client: the PixelProof contract, tag1 pixelproof, tag2 consensus).",
    services: [{ name: "agentWallet", endpoint: `eip155:${chainId}:${scanner}` }],
    active: true,
    registrations: agentId == null ? [] : [{ agentId: Number(agentId), agentRegistry: `eip155:${chainId}:${identity}` }],
    supportedTrust: ["reputation"],
  };
  return "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(card))));
}

export function createProfileClient({ chain, rpcUrl, contract, identity, reputation }) {
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain, transport });

  async function send(account, address, abi, functionName, args) {
    const wallet = createWalletClient({ account, chain, transport });
    const gas = await pub.estimateContractGas({ account, address, abi, functionName, args });
    const hash = await wallet.writeContract({ address, abi, functionName, args, gas: GAS_PAD(gas) });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
    return r;
  }

  async function status(identityAddr, scannerAddr) {
    const [idBal, scBal, sc] = await Promise.all([
      pub.getBalance({ address: identityAddr }),
      pub.getBalance({ address: scannerAddr }),
      contract ? pub.readContract({ address: contract, abi: pixelProofAbi, functionName: "getScanner", args: [scannerAddr] }) : null,
    ]);
    let rep = null;
    if (sc && sc.hasAgent && reputation) {
      const [count, value, decimals] = await pub.readContract({ address: reputation, abi: reputationAbi, functionName: "getSummary", args: [sc.agentId, [contract], "pixelproof", "consensus"] });
      rep = { count: Number(count), agreement: count ? Number(value) / 10 ** decimals : null };
    }
    return { identityBalance: idBal, scannerBalance: scBal, scanner: sc, reputation: rep };
  }

  /** move a little MON from the identity key to the scanner key for gas */
  async function fundScanner(identityAccount, scannerAddr, amount = "0.05") {
    const wallet = createWalletClient({ account: identityAccount, chain, transport });
    const hash = await wallet.sendTransaction({ to: scannerAddr, value: parseEther(amount), gas: 21_000n });
    await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return hash;
  }

  /**
   * register an ERC-8004 agent owned by the identity key, make the scanner
   * key its agentWallet (scanner signs consent), and link it in PixelProof.
   * `onStep(label)` reports progress. Resumable: skips finished steps.
   */
  async function setupAgent({ identityAccount, scannerAccount, handle = "", onStep = () => {} }) {
    const me = await pub.readContract({ address: contract, abi: pixelProofAbi, functionName: "getScanner", args: [scannerAccount.address] });
    if (me.hasAgent) return { agentId: me.agentId, already: true };

    onStep("Registering your ERC-8004 agent identity");
    const reg = await send(identityAccount, identity, identityAbi, "register",
      [scannerCard({ chainId: chain.id, identity, scanner: scannerAccount.address, handle })]);
    const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: reg.logs });
    const agentId = ev.args.agentId;

    onStep("Publishing the agent's registration file");
    await send(identityAccount, identity, identityAbi, "setAgentURI",
      [agentId, scannerCard({ chainId: chain.id, identity, scanner: scannerAccount.address, handle, agentId })]);

    onStep("Making your scanner key the agent's wallet");
    const block = await pub.getBlock();
    const deadline = block.timestamp + 240n; // registry allows at most 5 minutes ahead
    const signature = await scannerAccount.signTypedData({
      domain: { name: "ERC8004IdentityRegistry", version: "1", chainId: chain.id, verifyingContract: identity },
      types: { AgentWalletSet: [
        { name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" },
        { name: "owner", type: "address" }, { name: "deadline", type: "uint256" },
      ] },
      primaryType: "AgentWalletSet",
      message: { agentId, newWallet: scannerAccount.address, owner: identityAccount.address, deadline },
    });
    await send(identityAccount, identity, identityAbi, "setAgentWallet", [agentId, scannerAccount.address, deadline, signature]);

    onStep("Linking the agent to your PixelProof scanner");
    await send(scannerAccount, contract, pixelProofAbi, "linkAgent", [agentId]);
    if (handle) {
      onStep("Saving your handle");
      await send(scannerAccount, contract, pixelProofAbi, "setHandle", [handle.replace(/^@/, "").slice(0, 32)]);
    }
    return { agentId, already: false };
  }

  const setHandle = (scannerAccount, h) => send(scannerAccount, contract, pixelProofAbi, "setHandle", [h.replace(/^@/, "").slice(0, 32)]);

  return { pub, status, fundScanner, setupAgent, setHandle };
}
