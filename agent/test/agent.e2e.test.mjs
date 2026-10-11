// End-to-end on a local anvil chain with the real ERC-8004 reference registries
// (compiled by `forge build` in ../contracts) and PixelProof:
//   register agent -> requester asks for validation -> validator answers onchain
//   -> verdict attested in PixelProof -> HTTP API + MCP report the community verdict.
// Needs anvil on PATH, compiled contracts, and the model (PIXELPROOF_MODEL or ~/.pixelproof cache).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFile } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { foundry } from "viem/chains";
import { validationAbi, pixelProofAbi } from "../src/chain.js";

const run = promisify(execFile);
const OUT = new URL("../../contracts/out/", import.meta.url);
const art = (file, name) => JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT)));
const SAMPLES = new URL("../../extension/test/fixtures/", import.meta.url);
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const skip = !hasAnvil || !existsSync(new URL("IdentityRegistryUpgradeable.sol", OUT)) ? "anvil or compiled contracts missing" : false;

const PORT = 8551, RPC = `http://127.0.0.1:${PORT}`;
const KEYS = [ // anvil dev accounts 0 and 1, plus a fresh requester funded below
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  generatePrivateKey(),
];
const deployer = privateKeyToAccount(KEYS[0]);

test("agent: ERC-8004 validation round trip + HTTP + MCP", { skip, timeout: 240_000 }, async (t) => {
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const w = createWalletClient({ account: deployer, chain: foundry, transport: http(RPC) });
  const deploy = async (a, args = []) => (await pub.waitForTransactionReceipt({ hash: await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })).contractAddress;
  const call = async (address, abi, functionName, args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args }) });

  // ERC-8004 registries the way they are deployed on Monad: proxy -> MinimalUUPS -> upgrade
  const boot = art("HardhatMinimalUUPS.sol", "HardhatMinimalUUPS"), proxy = art("ERC1967Proxy.sol", "ERC1967Proxy");
  async function registry(name, identityArg) {
    const b = await deploy(boot);
    const p = await deploy(proxy, [b, encodeFunctionData({ abi: boot.abi, functionName: "initialize", args: [identityArg] })]);
    const impl = art(`${name}.sol`, name);
    const implAddr = await deploy(impl);
    const init = name === "IdentityRegistryUpgradeable" ? encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [] })
      : encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [identityArg] });
    await call(p, boot.abi, "upgradeToAndCall", [implAddr, init]);
    return p;
  }
  const identity = await registry("IdentityRegistryUpgradeable", "0x0000000000000000000000000000000000000000");
  const reputation = await registry("ReputationRegistryUpgradeable", identity);
  const validation = await registry("ValidationRegistryUpgradeable", identity);
  const pixelproof = await deploy(art("PixelProof.sol", "PixelProof"), [identity, reputation]);
  await pub.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: privateKeyToAccount(KEYS[2]).address, value: parseEther("1") }) });

  // serve a known AI-generated sample image locally
  const img = readFileSync(new URL("fake_sample.png", SAMPLES));
  const files = createServer((req, res) => { res.writeHead(200, { "content-type": "image/png" }); res.end(img); }).listen(8552, "127.0.0.1");
  t.after(() => files.close());
  const imageUrl = "http://127.0.0.1:8552/fake.png";

  const cache = mkdtempSync(join(tmpdir(), "ppagent-"));
  const env = {
    ...process.env, PIXELPROOF_NETWORK: "testnet", PIXELPROOF_RPC: RPC, PIXELPROOF_CHAIN_ID: "31337", PIXELPROOF_CONTRACT: pixelproof,
    ERC8004_IDENTITY: identity, ERC8004_REPUTATION: reputation, ERC8004_VALIDATION: validation,
    AGENT_PRIVATE_KEY: KEYS[1], REQUESTER_PRIVATE_KEY: KEYS[2], PIXELPROOF_CACHE: cache, ALLOW_PRIVATE_URLS: "1",
  };
  const cli = async (...args) => {
    try {
      return await run("node", [new URL("../src/cli.js", import.meta.url).pathname, ...args], { env, maxBuffer: 1 << 24 });
    } catch (e) {
      throw new Error(`cli ${args[0]} failed: ${e.stderr || e.message}`);
    }
  };

  const reg = JSON.parse((await cli("register", "--handle", "pixelproof_verifier")).stdout);
  assert.equal(reg.wallet, privateKeyToAccount(KEYS[1]).address);
  env.AGENT_ID = String(reg.agentId);

  const req = JSON.parse((await cli("request", imageUrl, "--validator", reg.wallet)).stdout);
  await cli("validator", "--once");

  const [validator, agentId, response, responseHash, tag] = await pub.readContract({ address: validation, abi: validationAbi, functionName: "getValidationStatus", args: [req.requestHash] });
  assert.equal(validator, reg.wallet);
  assert.equal(agentId, BigInt(req.requesterAgent));
  assert.ok(response <= 10, `AI image should score low authenticity, got ${response}`);
  assert.equal(tag, "pixelproof/ai-image");
  assert.notEqual(responseHash, "0x" + "0".repeat(64));

  // the verdict was also recorded in PixelProof by the agent-scanner, linked to its agent id
  const scanner = await pub.readContract({ address: pixelproof, abi: pixelProofAbi, functionName: "getScanner", args: [reg.wallet] });
  assert.equal(scanner.scans, 1);
  assert.equal(scanner.hasAgent, true);
  assert.equal(scanner.agentId, BigInt(reg.agentId));
  assert.equal(scanner.handle, "pixelproof_verifier");

  // re-running the validator does not answer twice
  await cli("validator", "--once");

  // HTTP API + MCP see the onchain community verdict
  env.PORT = "8553";
  const srv = spawn("node", [new URL("../src/cli.js", import.meta.url).pathname, "serve"], { env, stdio: ["ignore", "ignore", "pipe"] });
  t.after(() => srv.kill());
  await new Promise((resolve) => srv.stderr.on("data", (d) => String(d).includes("agent API") && resolve()));
  const v = await (await fetch(`http://127.0.0.1:8553/verify?url=${encodeURIComponent(imageUrl)}`)).json();
  assert.equal(v.verdict, "ai");
  assert.equal(v.community.reports, 1);
  assert.equal(v.community.aiVotes, 1);

  const card = await (await fetch("http://127.0.0.1:8553/.well-known/agent-registration.json")).json();
  assert.equal(card.registrations[0].agentId, Number(reg.agentId));

  const mcp = async (body) => (await fetch("http://127.0.0.1:8553/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body),
  })).json();
  await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  const tools = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(tools.result.tools.map((x) => x.name).sort(), ["lookup_phash", "verify_image"]);
  const called = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lookup_phash", arguments: { pHash: v.pHash } } });
  assert.equal(JSON.parse(called.result.content[0].text).community.reports, 1);
});
