// Monad network + contract configuration.
// After deploying (see contracts/README), paste the address into `contract`.
import { monad, monadTestnet } from "viem/chains";

export const NETWORKS = {
  testnet: {
    label: "Monad Testnet",
    chain: monadTestnet, // chain id 10143
    rpcUrl: "https://testnet-rpc.monad.xyz",
    contract: "0x0000000000000000000000000000000000000000",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713", // ERC-8004
    explorer: "https://testnet.monadvision.com",
    faucet: "https://buildanything.so/faucet",
  },
  mainnet: {
    label: "Monad Mainnet",
    chain: monad, // chain id 143
    rpcUrl: "https://rpc.monad.xyz",
    contract: "0x0000000000000000000000000000000000000000",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63", // ERC-8004
    explorer: "https://monadvision.com",
    faucet: null,
  },
};

export const LEADERBOARD_URL = "https://nadeye.example/"; // set to your hosted web/ page
// Pages allowed to hand the extension a passkey-derived scanner key
// (editable on the options page). Add your hosted site's origin.
export const SITE_ORIGINS = ["http://localhost:8080", "http://localhost:5173"];

// Onchain vote bands, same as Nadeye.sol; scores in between are never sent.
export const AI_THRESHOLD_BPS = 8000;
export const REAL_CEILING_BPS = 5000;
export const isRecordable = (bps) => bps < REAL_CEILING_BPS || bps >= AI_THRESHOLD_BPS;
// Half the contract's 100: judged verdicts also write ERC-8004 feedback, which costs more gas.
export const MAX_BATCH = 50;
export const AUTO_FLUSH_AT = 25; // queue size that triggers an immediate batch
// Monad bills the gas limit, not gas used, so pad the estimate by 15% instead of 2x.
export const GAS_BUFFER = 1.15;
