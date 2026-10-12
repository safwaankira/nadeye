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
  const network = env.NADEYE_NETWORK || "testnet";
  const base = NETWORKS[network];
  if (!base) throw new Error(`NADEYE_NETWORK must be mainnet or testnet, got ${network}`);
  const chain = env.NADEYE_CHAIN_ID
    ? { ...base.chain, id: Number(env.NADEYE_CHAIN_ID) } // local anvil runs
    : base.chain;
  return {
    network,
    chain,
    rpcUrl: env.NADEYE_RPC || base.rpcUrl,
    explorer: base.explorer,
    contract: env.NADEYE_CONTRACT || null,
    identity: env.ERC8004_IDENTITY || base.identity,
    reputation: env.ERC8004_REPUTATION || base.reputation,
    validation: env.ERC8004_VALIDATION || base.validation,
    privateKey: env.AGENT_PRIVATE_KEY || null,
    agentId: env.AGENT_ID != null && env.AGENT_ID !== "" ? BigInt(env.AGENT_ID) : null,
    attest: (env.AGENT_ATTEST ?? "1") !== "0",
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 8787),
    cacheDir: env.NADEYE_CACHE || join(homedir(), ".nadeye"),
    modelPath: env.NADEYE_MODEL || null,
    allowPrivate: env.ALLOW_PRIVATE_URLS === "1", // tests only
    // HTTP API: extra Host names to accept (e.g. a tunnel's), and browser origins allowed to call it
    allowedHosts: (env.NADEYE_ALLOWED_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    corsOrigins: (env.NADEYE_CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    // validator spend limits: answers per requesting agent per hour, and a wallet floor in wei
    validatorMaxPerHour: Number(env.NADEYE_VALIDATOR_MAX_PER_HOUR || 30),
    validatorMinBalanceWei: BigInt(Math.round(Number(env.NADEYE_VALIDATOR_MIN_BALANCE || "0.05") * 1e6)) * 10n ** 12n,
  };
}
