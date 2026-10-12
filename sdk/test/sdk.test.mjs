// SDK against a real registry on anvil: attest an image's hash, then find it again from a
// resized copy through lookupImage; passkey flags; verdict merging; pHash parity with the extension.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createNadeyeClient, communityVerdict, pHashDetail, toKey } from "../src/index.js";

const OUT = new URL("../../contracts/out/", import.meta.url);
const skip = spawnSync("anvil", ["--version"]).status !== 0 || !existsSync(new URL("Nadeye.sol", OUT)) ? "anvil or compiled contracts missing" : false;

/** a smooth synthetic photo-like image, rendered at any size */
function image(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, i = (y * w + x) * 4;
    data[i] = 128 + 100 * Math.sin(6 * u + 2 * v); data[i + 1] = 128 + 90 * Math.cos(5 * v - 3 * u); data[i + 2] = 255 * u * v; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("the SDK's pHash is the extension's, byte for byte", () => {
  assert.equal(readFileSync(new URL("../src/phash.js", import.meta.url), "utf8"), readFileSync(new URL("../../extension/src/phash.js", import.meta.url), "utf8"));
});

test("communityVerdict merges variants and reports ties as split", () => {
  assert.deepEqual(communityVerdict([]).verdict, "none");
  const v = communityVerdict([{ reports: 3, aiVotes: 3, meanScore: 9000 }, { reports: 1, aiVotes: 0, meanScore: 1000 }]);
  assert.equal(v.verdict, "ai"); assert.equal(v.reports, 4); assert.equal(v.meanScore, 0.7);
  assert.equal(communityVerdict([{ reports: 2, aiVotes: 1, meanScore: 5000 }]).verdict, "split");
});

test("lookupImage finds a resized copy of an attested image; passkey flags read", { skip, timeout: 120_000 }, async (t) => {
  const PORT = 8563, RPC = `http://127.0.0.1:${PORT}`;
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const keys = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"];
  const wallet = (k) => createWalletClient({ account: privateKeyToAccount(k), chain: foundry, transport: http(RPC) });
  const art = (f, n) => JSON.parse(readFileSync(new URL(`${f}/${n}.json`, OUT)));
  const deploy = async (a, args = []) => (await pub.waitForTransactionReceipt({ hash: await wallet(keys[0]).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })).contractAddress;
  const N = art("Nadeye.sol", "Nadeye");
  const nadeye = await deploy(N, ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"]);
  const passkeys = await deploy(art("PasskeyRegistry.sol", "PasskeyRegistry"));

  const original = pHashDetail(image(640, 480)).hex;
  for (const [k, score] of [[keys[0], 9300], [keys[1], 8800]]) {
    const hash = await wallet(k).writeContract({ address: nadeye, abi: N.abi, functionName: "attest", args: [toKey(original), score, 1] });
    await pub.waitForTransactionReceipt({ hash });
  }
  const client = createNadeyeClient({ chain: foundry, rpcUrl: RPC, nadeye, passkeys });
  const found = await client.lookupImage(image(300, 225)); // a downscaled copy
  assert.equal(found.verdict, "ai");
  assert.equal(found.reports, 2);
  assert.equal(found.candidates, 37);
  assert.deepEqual(await client.stats(), { scans: 2, images: 1, scanners: 2, flagged: 1 });
  const s = await client.scanner(privateKeyToAccount(keys[0]).address);
  assert.equal(s.scans, 1); assert.equal(s.passkey, false);
  assert.equal((await client.lookupHashes("0123456789abcdef")).verdict, "none");
});
