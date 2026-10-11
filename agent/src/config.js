// Agent configuration from environment variables (see agent/.env.example).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { monad, monadTestnet } from "viem/chains";

// load ./.env if present (no dependency needed for KEY=value lines)
const envFile = join(process.cwd(), ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const NETWORKS = {
  mainnet: {
    chain: monad,
    rpcUrl: "https://rpc.monad.xyz",
    explorer: "https://monadvision.com",
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
  },
  testnet: {
    chain: monadTestnet,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorer: "https://testnet.monadvision.com",
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
};

export function loadConfig(env = process.env) {
  const network = env.PIXELPROOF_NETWORK || "mainnet";
  const base = NETWORKS[network];
  if (!base) throw new Error(`PIXELPROOF_NETWORK must be mainnet or testnet, got ${network}`);
  const chain = env.PIXELPROOF_CHAIN_ID
    ? { ...base.chain, id: Number(env.PIXELPROOF_CHAIN_ID) } // local anvil runs
    : base.chain;
  return {
    network,
    chain,
    rpcUrl: env.PIXELPROOF_RPC || base.rpcUrl,
    explorer: base.explorer,
    contract: env.PIXELPROOF_CONTRACT || null,
    identity: env.ERC8004_IDENTITY || base.identity,
    reputation: env.ERC8004_REPUTATION || base.reputation,
    validation: env.ERC8004_VALIDATION || base.validation,
    privateKey: env.AGENT_PRIVATE_KEY || null,
    agentId: env.AGENT_ID != null && env.AGENT_ID !== "" ? BigInt(env.AGENT_ID) : null,
    attest: (env.AGENT_ATTEST ?? "1") !== "0",
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 8787),
    cacheDir: env.PIXELPROOF_CACHE || join(homedir(), ".pixelproof"),
    modelPath: env.PIXELPROOF_MODEL || null,
    allowPrivate: env.ALLOW_PRIVATE_URLS === "1", // tests only
  };
}
