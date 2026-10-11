// Service-worker wiring test: loads the real src/background.js under a mocked
// `chrome` API, with the offscreen model stubbed out, against a local anvil
// node running with Monad testnet's chain id (10143).
// analyze -> contribute -> queue -> flush -> attestBatch -> community lookup.
// Needs `anvil` on PATH, the compiled contract and `npm run build`.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARTIFACT = new URL("../../contracts/out/PixelProof.sol/PixelProof.json", import.meta.url);
const BUNDLE = new URL("../src/chain.bundle.js", import.meta.url);
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const skip = !hasAnvil || !existsSync(ARTIFACT) || !existsSync(BUNDLE) ? "anvil, compiled contract or bundle missing" : false;

const PORT = 8548;
const RPC = `http://127.0.0.1:${PORT}`;
const local = defineChain({ id: 10143, name: "anvil-as-monad-testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const FUNDER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

function area(listeners, name) {
  const m = {};
  return {
    async get(keys, cb) {
      let out = {};
      if (Array.isArray(keys)) for (const k of keys) { if (k in m) out[k] = structuredClone(m[k]); }
      else if (typeof keys === "string") { if (keys in m) out[keys] = structuredClone(m[keys]); }
      else if (keys && typeof keys === "object") out = Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in m ? structuredClone(m[k]) : d]));
      if (cb) cb(out);
      return out;
    },
    async set(o) {
      const changes = {};
      for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: m[k], newValue: v }; m[k] = structuredClone(v); }
      for (const l of listeners) l(changes, name);
    },
    async remove(keys) { for (const k of [].concat(keys)) delete m[k]; },
  };
}

function mockChrome(fakeInfer) {
  const msgListeners = [];
  const changeListeners = [];
  const ev = () => ({ addListener() {} });
  globalThis.chrome = {
    storage: {
      sync: area(changeListeners, "sync"),
      local: area(changeListeners, "local"),
      session: area(changeListeners, "session"),
      onChanged: { addListener: (f) => changeListeners.push(f) },
    },
    runtime: {
      onMessage: { addListener: (f) => msgListeners.push(f) },
      onInstalled: ev(),
      getManifest: () => ({ version: "1.0.0" }),
      getURL: (p) => `chrome-extension://test/${p}`,
      async sendMessage(msg) {
        if (msg.kind === "aid:infer") return fakeInfer(msg.url);
        return { ok: true };
      },
    },
    offscreen: { hasDocument: async () => true, createDocument: async () => {} },
    alarms: { create() {}, onAlarm: ev() },
    contextMenus: { onClicked: ev(), removeAll() {}, create() {} },
    tabs: { create() {}, sendMessage() {} },
  };
  // what content scripts / the popup do: post a message, await the reply
  return (msg, sender = {}) => new Promise((resolve) => {
    let handled = false;
    for (const l of msgListeners) {
      const r = l(msg, sender, (v) => resolve(v));
      if (r === true) handled = true;
    }
    if (!handled) resolve(undefined);
  });
}

test("background: analyze -> attest -> community verdict", { skip }, async (t) => {
  const anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "10143", "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: local, transport: http(RPC) });
  for (let i = 0; i < 50; i++) {
    try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const { abi, bytecode } = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const funder = createWalletClient({ account: FUNDER, chain: local, transport: http(RPC) });
  const { contractAddress } = await pub.waitForTransactionReceipt({ hash: await funder.deployContract({ abi, bytecode: bytecode.object, args: ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"] }) });

  // stubbed model: deterministic score + hash per URL
  const hashes = { "https://a.example/1.jpg": "a1b2c3d4e5f60718", "https://a.example/2.jpg": "0f0f0f0f12345678", "https://a.example/3.jpg": "ffeeddccbbaa9988" };
  const send = mockChrome((url) => ({
    ok: true, score: url.endsWith("2.jpg") ? 0.12 : 0.93, ms: 30, tta: false,
    degraded: url.endsWith("3.jpg"), // degraded verdicts must not be attested
    phash: hashes[url], phashNear: [hashes[url], "0000000000000001"],
  }));

  await chrome.storage.local.set({ ppCustom: { testnet: { contract: contractAddress, rpcUrl: RPC } } });
  await chrome.storage.sync.set({ ppContribute: true, ppNetwork: "testnet" });
  await import(`../src/background.js?${Date.now()}`);
  await new Promise((r) => setTimeout(r, 50)); // settings load

  const st0 = await send({ kind: "pp:status" });
  assert.equal(st0.ok, true);
  assert.equal(st0.configured, true);
  assert.equal(st0.balance, "0");
  const st0Key = (await send({ kind: "pp:export-key" })).key;
  await pub.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: st0.address, value: parseEther("1") }) });

  for (const url of Object.keys(hashes)) {
    const r = await send({ kind: "aid:analyze", url });
    assert.equal(r.phash, hashes[url]);
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await send({ kind: "pp:status" })).queued, 2, "degraded verdict not queued");

  const f = await send({ kind: "pp:flush" });
  assert.equal(f.sent, 2);

  const c1 = await send({ kind: "pp:community", phash: hashes["https://a.example/1.jpg"], near: [hashes["https://a.example/1.jpg"], "0000000000000001"] });
  assert.equal(c1.reports, 1);
  assert.equal(c1.aiVotes, 1);
  const c3 = await send({ kind: "pp:community", phash: hashes["https://a.example/3.jpg"] });
  assert.equal(c3, null);

  // passkey-site bridge: only trusted origins may set the scanner key
  const key = "0x" + "11".repeat(32);
  const evil = await send({ kind: "pp:site-import-key", key }, { url: "https://evil.example/claim" });
  assert.equal(evil.ok, false);
  assert.equal((await send({ kind: "pp:site-scanner" }, { url: "https://evil.example/" })).ok, false);
  const before = (await send({ kind: "pp:status" })).address;
  const good = await send({ kind: "pp:site-import-key", key }, { url: "http://localhost:8080/#me" });
  assert.equal(good.ok, true);
  assert.notEqual(good.address, before);
  assert.equal((await send({ kind: "pp:site-scanner" }, { url: "http://localhost:8080/" })).address, good.address);
  await send({ kind: "pp:import-key", key: (await chrome.storage.local.get(["ppKeyBackup"])).ppKeyBackup || st0Key });

  const st = await send({ kind: "pp:status" });
  assert.equal(st.me.scans, 2);
  assert.equal(st.me.points, 70);
  assert.equal(st.queued, 0);
});
