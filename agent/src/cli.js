#!/usr/bin/env node
// nadeye-agent <command>
//   verify <url|file> [--attest]   score one image, print JSON
//   serve [--public-url URL] [--validator]   HTTP API + MCP at /mcp (+ validator loop)
//   mcp                            MCP over stdio (Claude Desktop / Claude Code)
//   validator [--once]             answer ERC-8004 validation requests onchain
//   register [--public-url URL] [--handle NAME]   ERC-8004 identity + link to Nadeye
//   request <imageUrl> [--validator 0x…]   demo: ask a validator (needs REQUESTER_PRIVATE_KEY)
//   status                         wallet, agent, reputation, scanner stats
import { existsSync, readFileSync } from "node:fs";
import { keccak256, toBytes, formatEther, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { createDetector } from "./detector.js";
import { createChainClient, identityAbi, validationAbi } from "./chain.js";
import { createVerifier } from "./verify.js";
import { createApi } from "./server.js";
import { createDrip } from "./drip.js";
import { runStdio, httpMcpHandler } from "./mcp.js";
import { createValidator } from "./validator.js";
import { agentCard, toDataUri } from "./card.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : null; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--") && !["--attest", "--validator", "--once"].includes(rest[i - 1])));
const out = (o) => console.log(JSON.stringify(o, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
const err = (...a) => console.error(...a);

const cfg = loadConfig();
const chain = createChainClient(cfg);
cfg.walletAddress = chain.account?.address;

async function boot() {
  const detector = await createDetector(cfg);
  cfg.modelVersion = detector.meta.version;
  return { detector, verifier: createVerifier({ detector, chain, cfg }) };
}

async function main() {
  switch (cmd) {
    case "verify": {
      const target = positional[0];
      if (!target) throw new Error("usage: verify <url|file> [--attest]");
      const { verifier } = await boot();
      const res = existsSync(target)
        ? await verifier.verifyBytes(readFileSync(target), { source: target, attest: flag("attest") })
        : await verifier.verifyUrl(target, { attest: flag("attest") });
      return out(res);
    }
    case "serve": {
      const { verifier } = await boot();
      const publicUrl = opt("public-url");
      const drip = cfg.drip.enabled && chain.wallet
        ? createDrip({ cfg, pub: chain.pub, from: chain.account.address, send: (to, value) => chain.wallet.sendTransaction({ to, value, gas: 21_000n }) })
        : null;
      if (cfg.drip.enabled && cfg.network !== "testnet") err("NADEYE_DRIP is ignored on mainnet");
      const api = createApi({ verifier, cfg, publicUrl, drip, mcpHandler: httpMcpHandler({ verifier, chain }) });
      api.listen(cfg.port, cfg.host, () => err(`Nadeye agent API on http://${cfg.host}:${cfg.port}  (GET /verify?url=…, POST /mcp)`));
      if (flag("validator")) createValidator({ cfg, chain, verifier }).run().catch((e) => err("validator stopped:", e));
      return;
    }
    case "mcp": {
      const { verifier } = await boot();
      return runStdio({ verifier, chain });
    }
    case "validator": {
      const { verifier } = await boot();
      const v = createValidator({ cfg, chain, verifier });
      return v.run({ once: flag("once") });
    }
    case "register": {
      if (!cfg.contract) throw new Error("set NADEYE_CONTRACT first");
      const publicUrl = opt("public-url");
      let agentId = cfg.agentId;
      if (agentId == null) {
        const r = await chain.register(toDataUri(agentCard(cfg, { publicUrl })));
        agentId = r.agentId;
        err(`registered ERC-8004 agent #${agentId} (${r.hash})`);
      }
      // now that the id is known, publish the full registration file
      await chain.send(cfg.identity, identityAbi, "setAgentURI", [agentId, toDataUri(agentCard(cfg, { agentId, publicUrl }))]);
      await chain.linkAgent(agentId);
      if (opt("handle")) await chain.setHandle(opt("handle"));
      err(`linked agent #${agentId} to Nadeye ${cfg.contract}. Add AGENT_ID=${agentId} to agent/.env`);
      return out({ agentId, wallet: chain.account.address, agentRegistry: `eip155:${cfg.chain.id}:${cfg.identity}` });
    }
    case "request": {
      const image = positional[0];
      const validator = opt("validator") || chain.account?.address;
      const key = process.env.REQUESTER_PRIVATE_KEY;
      if (!image || !validator || !key) throw new Error("usage: request <imageUrl> --validator 0x… (with REQUESTER_PRIVATE_KEY set)");
      const requester = createChainClient({ ...cfg, privateKey: key });
      let requesterAgent = process.env.REQUESTER_AGENT_ID ? BigInt(process.env.REQUESTER_AGENT_ID) : null;
      if (requesterAgent == null) {
        const r = await requester.register(toDataUri({ type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: "Nadeye demo requester", description: "Asks validators whether images are AI-generated.", services: [], active: true, registrations: [] }));
        requesterAgent = r.agentId;
        err(`registered requester agent #${requesterAgent}; set REQUESTER_AGENT_ID=${requesterAgent} to reuse it`);
      }
      const requestHash = keccak256(toBytes(`${image}|${Date.now()}`));
      const rc = await requester.send(cfg.validation, validationAbi, "validationRequest", [validator, requesterAgent, image, requestHash]);
      err(`requested validation ${requestHash} in ${rc.transactionHash}; the validator answers within a few seconds`);
      return out({ requestHash, requesterAgent, validator, tx: rc.transactionHash, explorer: `${cfg.explorer}/tx/${rc.transactionHash}` });
    }
    case "status": {
      const res = { network: cfg.network, contract: cfg.contract, wallet: chain.account?.address ?? null, agentId: cfg.agentId };
      if (chain.account) res.balance = formatEther(await chain.pub.getBalance({ address: chain.account.address })) + " MON";
      if (cfg.contract && chain.account) {
        const { nadeyeAbi } = await import("./chain.js");
        res.scanner = await chain.pub.readContract({ address: cfg.contract, abi: nadeyeAbi, functionName: "getScanner", args: [chain.account.address] });
        if (res.scanner.hasAgent) res.reputation = await chain.reputation(res.scanner.agentId);
      }
      return out(res);
    }
    default:
      err(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => { err(`error: ${e.shortMessage || e.message || e}`); process.exit(1); });
