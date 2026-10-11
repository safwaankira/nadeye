// End-to-end: burner wallet -> queued verdicts -> attestBatch -> registry
// lookup -> scanner stats, against a local anvil node.
// Needs `anvil` on PATH and the compiled contract (cd ../contracts && forge build).
// Skips cleanly when either is missing.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createChain } from "../src/chain/index.js";

const ARTIFACT = new URL("../../contracts/out/PixelProof.sol/PixelProof.json", import.meta.url);
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
const skip = !hasAnvil || !existsSync(ARTIFACT) ? "anvil or compiled contract missing" : false;

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's well-known dev account #0
const FUNDER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

function memStore() {
  const m = {};
  return {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, structuredClone(m[k])])),
    set: async (o) => Object.assign(m, structuredClone(o)),
  };
}

test("attest, look up and score through the chain client", { skip }, async (t) => {
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) {
    try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const { abi, bytecode } = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const funder = createWalletClient({ account: FUNDER, chain: foundry, transport: http(RPC) });
  const deployHash = await funder.deployContract({ abi, bytecode: bytecode.object, args: ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"] });
  const { contractAddress } = await pub.waitForTransactionReceipt({ hash: deployHash });

  const override = { chain: foundry, rpcUrl: RPC, contract: contractAddress, label: "anvil" };
  const alice = createChain({ store: memStore(), network: "testnet", override });
  const bob = createChain({ store: memStore(), network: "testnet", override });
  assert.ok(alice.configured());

  // unfunded wallet: nothing is sent, nothing is lost
  const keyOf = (i) => "0x" + i.toString(16).padStart(64, "0");
  await alice.enqueue([{ key: keyOf(1), score: 0.9 }]);
  const dry = await alice.flush(7);
  assert.equal(dry.reason, "no-gas");
  assert.equal((await alice.status()).queued, 1);

  for (const c of [alice, bob]) {
    const h = await funder.sendTransaction({ to: (await c.account()).address, value: parseEther("1") });
    await pub.waitForTransactionReceipt({ hash: h });
  }

  // alice scans 30 images (one is the zero key, which must be dropped)
  await alice.enqueue([...Array(30)].map((_, i) => ({ key: keyOf(i + 1), score: i % 3 === 0 ? 0.2 : 0.91 })));
  await alice.enqueue([{ key: keyOf(0), score: 0.9 }, { key: keyOf(5), score: 0.9 }]); // dupes/zero ignored
  const r1 = await alice.flush(7);
  assert.equal(r1.sent, 30);
  assert.equal(r1.remaining, 0);

  // re-queueing something already attested is a no-op
  assert.equal(await alice.enqueue([{ key: keyOf(2), score: 0.9 }]), 0);

  // bob confirms some of them
  await bob.enqueue([2, 3, 4].map((i) => ({ key: keyOf(i), score: 0.88 })));
  assert.equal((await bob.flush(7)).sent, 3);

  const seen = await bob.lookup([keyOf(2), keyOf(4), keyOf(999)]);
  assert.equal(seen[keyOf(2)].reports, 2);
  assert.equal(seen[keyOf(2)].aiVotes, 2);
  assert.ok(Math.abs(seen[keyOf(2)].meanScore - 0.895) < 1e-9);
  assert.equal(seen[keyOf(999)].reports, 0);

  await alice.setHandle("@safwaan_uddin");
  const st = await alice.status();
  assert.equal(st.me.scans, 30);
  assert.equal(st.me.firsts, 30);
  assert.equal(st.me.points, 30 * 35);
  assert.equal(st.me.handle, "safwaan_uddin");
  assert.equal(st.me.activeDays, 1);
  assert.ok(st.lastTx && st.lastTx.n === 30);

  const [scans, images, scanners] = await pub.readContract({ address: contractAddress, abi, functionName: "stats" });
  assert.equal(scans, 33n);
  assert.equal(images, 30n);
  assert.equal(scanners, 2n);
});
