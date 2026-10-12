// Testnet drip: off unless enabled, never on mainnet, once per address (survives restarts),
// per-IP and daily caps, skips funded or contract addresses, keeps the wallet floor, serializes.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther } from "viem";
import { createDrip } from "../src/drip.js";
import { createApi } from "../src/server.js";

const FROM = "0x00000000000000000000000000000000000A9E17";
const addr = (i) => "0x" + i.toString(16).padStart(40, "0");

// A Monad-like chain: blocks advance on their own; each send is mined in the current block, and
// `revertNext` makes the next transfer revert (the reserve-balance failure mode).
function fakeChain({ balances = {}, code = {}, agent = parseEther("10"), recentTxBlocks = [] } = {}) {
  const sent = [];
  let inFlight = 0, maxInFlight = 0, block = 100n, revertNext = false;
  const agentTxBlocks = [...recentTxBlocks.map((b) => block - BigInt(b))]; // blocks the agent sent in
  const receipts = new Map();
  return {
    sent,
    get maxInFlight() { return maxInFlight; },
    tick() { block += 1n; },
    revertNext() { revertNext = true; },
    pub: {
      getBalance: async ({ address }) => (address === FROM ? agent : balances[address.toLowerCase()] ?? 0n),
      getCode: async ({ address }) => code[address.toLowerCase()] ?? "0x",
      getBlockNumber: async () => block,
      getTransactionCount: async ({ address, blockNumber, blockTag }) => {
        if (address !== FROM) return 0;
        const upTo = blockTag === "pending" ? block : blockNumber;
        return agentTxBlocks.filter((b) => b <= upTo).length;
      },
      waitForTransactionReceipt: async ({ hash }) => receipts.get(hash),
    },
    send: async (to, value) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      sent.push({ to, value, block });
      agentTxBlocks.push(block);
      const hash = "0x" + sent.length.toString(16).padStart(64, "0");
      receipts.set(hash, { status: revertNext ? "reverted" : "success" });
      revertNext = false;
      return hash;
    },
  };
}

const dir = mkdtempSync(join(tmpdir(), "drip-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const cfgFor = (over = {}) => ({ network: "testnet", validatorMinBalanceWei: parseEther("0.05"),
  drip: { enabled: true, amount: "0.1", perIpPerDay: 3, perDay: 5, file: join(dir, `${Math.random()}.json`) }, ...over });

test("drip is off by default and refused on mainnet", async () => {
  const c = fakeChain();
  assert.equal(createDrip({ cfg: { network: "testnet", drip: {} }, ...c, from: FROM, sleep: async () => c.tick() }).enabled, false);
  const main = createDrip({ cfg: cfgFor({ network: "mainnet" }), ...c, from: FROM, sleep: async () => c.tick() });
  assert.equal(main.enabled, false);
  await assert.rejects(main.request(addr(1), "1.1.1.1"), { status: 404 });
  assert.equal(c.sent.length, 0);
});

test("pays an address once, ever, even across restarts", async () => {
  const c = fakeChain(), cfg = cfgFor();
  const d = createDrip({ cfg, ...c, from: FROM, sleep: async () => c.tick() });
  const r = await d.request(addr(1), "1.1.1.1");
  assert.equal(r.amount, "0.1 MON");
  assert.equal(c.sent[0].value, parseEther("0.1"));
  await assert.rejects(d.request(addr(1).toUpperCase().replace("0X", "0x"), "2.2.2.2"), { status: 409 });
  const restarted = createDrip({ cfg, ...c, from: FROM, sleep: async () => c.tick() });
  await assert.rejects(restarted.request(addr(1), "3.3.3.3"), { status: 409 });
  assert.equal(c.sent.length, 1);
});

test("caps per IP and per day; skips bad, funded and contract addresses; keeps the floor", async () => {
  const c = fakeChain({ balances: { [addr(50)]: parseEther("1") }, code: { [addr(51)]: "0x6080" } });
  const d = createDrip({ cfg: cfgFor(), ...c, from: FROM, sleep: async () => c.tick() });
  await assert.rejects(d.request("not an address", "9.9.9.9"), { status: 400 });
  await assert.rejects(d.request(addr(50), "9.9.9.9"), { status: 409 }); // already has gas
  await assert.rejects(d.request(addr(51), "9.9.9.9"), { status: 400 }); // a contract
  for (const i of [1, 2, 3]) await d.request(addr(i), "1.1.1.1");
  await assert.rejects(d.request(addr(4), "1.1.1.1"), { status: 429, message: /your network/ });
  await d.request(addr(5), "2.2.2.2");
  await d.request(addr(6), "3.3.3.3");
  await assert.rejects(d.request(addr(7), "4.4.4.4"), { status: 429, message: /used up/ });
  assert.equal(c.sent.length, 5);

  const low = fakeChain({ agent: parseEther("0.12") }); // floor is 0.05 + 0.1
  await assert.rejects(createDrip({ cfg: cfgFor(), ...low, from: FROM }).request(addr(1), "1.1.1.1"), { status: 503 });
});

test("concurrent requests are serialized and can't double-pay", async () => {
  const c = fakeChain();
  const d = createDrip({ cfg: cfgFor({ drip: { enabled: true, amount: "0.1", perIpPerDay: 100, perDay: 100, file: join(dir, "c.json") } }), ...c, from: FROM, sleep: async () => c.tick() });
  const rs = await Promise.allSettled([...Array(10)].map(() => d.request(addr(9), "1.1.1.1")));
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(c.sent.length, 1);
  assert.equal(c.maxInFlight, 1);
});

test("a failed send is not counted against the address", async () => {
  const c = fakeChain();
  let fail = true;
  const send = async (to, v) => { if (fail) throw new Error("rpc down"); return c.send(to, v); };
  const d = createDrip({ cfg: cfgFor(), pub: c.pub, send, from: FROM, sleep: async () => c.tick() });
  await assert.rejects(d.request(addr(1), "1.1.1.1"), { status: 502 });
  fail = false;
  assert.ok((await d.request(addr(1), "1.1.1.1")).tx);
});

test("POST /drip: allow-listed origin only, JSON errors, tunnel client IP", async () => {
  const c = fakeChain();
  const drip = createDrip({ cfg: cfgFor({ drip: { enabled: true, amount: "0.1", perIpPerDay: 1, perDay: 10, file: join(dir, "h.json") } }), ...c, from: FROM, sleep: async () => c.tick() });
  const cfg = { network: "testnet", chain: { id: 10143 }, host: "127.0.0.1", allowedHosts: [], corsOrigins: ["https://nadeye.example"] };
  const api = createApi({ verifier: {}, cfg, drip });
  await new Promise((ok) => api.listen(0, "127.0.0.1", ok));
  const port = api.address().port;
  const call = (body, headers = {}, method = "POST") => new Promise((ok, fail) => {
    const r = request({ host: "127.0.0.1", port, path: "/drip", method, headers: { host: `localhost:${port}`, "content-type": "application/json", ...headers } }, (res) => {
      let b = ""; res.on("data", (x) => (b += x)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, json: b ? JSON.parse(b) : null }));
    });
    r.on("error", fail); r.end(body);
  });
  try {
    assert.equal((await call(JSON.stringify({ address: addr(1) }), { origin: "https://evil.example" })).status, 403);
    assert.equal((await call("", {}, "GET")).status, 405);
    assert.equal((await call("{nope", { origin: "https://nadeye.example" })).status, 400);
    let r = await call(JSON.stringify({ address: addr(1) }), { origin: "https://nadeye.example", "cf-connecting-ip": "5.5.5.5" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["access-control-allow-origin"], "https://nadeye.example");
    // same tunnel client, new address: per-IP cap (1) applies to the forwarded IP
    r = await call(JSON.stringify({ address: addr(2) }), { "cf-connecting-ip": "5.5.5.5" });
    assert.equal(r.status, 429);
    // a different forwarded client still gets served
    assert.equal((await call(JSON.stringify({ address: addr(3) }), { "cf-connecting-ip": "6.6.6.6" })).status, 200);
  } finally {
    api.close();
  }
});

test("Monad reserve balance: waits until the agent wallet has been quiet for 3 blocks", async () => {
  const c = fakeChain({ recentTxBlocks: [1] }); // the validator answered one block ago
  let slept = 0;
  const sleep = async () => { slept++; c.tick(); }; // ~400 ms per Monad block
  const d = createDrip({ cfg: cfgFor(), ...c, from: FROM, sleep });
  await d.request(addr(1), "1.1.1.1");
  assert.equal(slept, 2, "waited until the earlier tx was 3 blocks old");
  // back-to-back drips: the second waits for the first to age out of the window
  await d.request(addr(2), "2.2.2.2");
  assert.ok(c.sent[1].block - c.sent[0].block >= 3n, `drips ${c.sent[0].block} and ${c.sent[1].block} are 3+ blocks apart`);
});

test("a transfer that reverted onchain is not counted as paid", async () => {
  const c = fakeChain();
  const d = createDrip({ cfg: cfgFor(), ...c, from: FROM, sleep: async () => c.tick() });
  c.revertNext();
  await assert.rejects(d.request(addr(1), "1.1.1.1"), { status: 502 });
  const ok = await d.request(addr(1), "1.1.1.1");
  assert.ok(ok.tx);
  assert.equal(c.sent.length, 2);
});
