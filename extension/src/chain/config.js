// Monad network + contract configuration.
// After deploying (see contracts/README), paste the address into `contract`.
import { monad, monadTestnet } from "viem/chains";

export const NETWORKS = {
  testnet: {
    label: "Monad Testnet",
    chain: monadTestnet, // chain id 10143
    rpcUrl: "https://testnet-rpc.monad.xyz",
    contract: "0x0000000000000000000000000000000000000000",
    explorer: "https://testnet.monadvision.com",
    faucet: "https://buildanything.so/faucet",
  },
  mainnet: {
    label: "Monad Mainnet",
    chain: monad, // chain id 143
    rpcUrl: "https://rpc.monad.xyz",
    contract: "0x0000000000000000000000000000000000000000",
    explorer: "https://monadvision.com",
    faucet: null,
  },
};

export const LEADERBOARD_URL = "https://pixelproof.example/leaderboard"; // set to your hosted web/ page

export const AI_THRESHOLD_BPS = 6500;
export const MAX_BATCH = 100;
export const AUTO_FLUSH_AT = 25; // queue size that triggers an immediate batch
// Monad bills the gas *limit*, not gas used — so keep the buffer over the
// estimate small instead of the usual 2x padding.
export const GAS_BUFFER = 1.15;
