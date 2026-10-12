// Private journal: a PRF namespace used for encryption (not an account). Same PRF output on
// a "second device" re-derives the same id and key and decrypts the journal stored on Monad;
// another passkey (or the account namespace) cannot; ciphertext is bound to its journal.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { sha256 } from "@noble/hashes/sha2.js";
import { JOURNAL_SALT, journalKeys, makeEntry, seal, open, readJournal, journalAbi } from "../src/journal.js";

const OUT = new URL("../../contracts/out/", import.meta.url);
const skip = spawnSync("anvil", ["--version"]).status !== 0 || !existsSync(new URL("NadeyeJournal.sol", OUT)) ? "anvil or compiled contracts missing" : false;
const prf = (seed) => sha256(new TextEncoder().encode(seed)); // stands in for a passkey's PRF output

test("the journal salt is its own namespace, separate from Mera's account salt", () => {
  const accountSalt = sha256(new TextEncoder().encode("mera.prf.salt.v1"));
  assert.equal(JOURNAL_SALT.length, 32);
  assert.notDeepEqual(JOURNAL_SALT, accountSalt);
});

test("same PRF output -> same id and key; entries round-trip; others can't open them", async () => {
  const a = await journalKeys(prf("passkey A, journal namespace"));
  const again = await journalKeys(prf("passkey A, journal namespace")); // the second device
  const b = await journalKeys(prf("passkey B, journal namespace"));
  assert.equal(a.id, again.id);
  assert.notEqual(a.id, b.id);
  const e = makeEntry({ pHash: "c3a1f00d12345678", verdict: "ai", reports: 3, aiVotes: 3, note: "seen in a news thread", at: 1791800000 });
  const box = await seal(a, e);
  assert.deepEqual(await open(again, box), e);
  assert.equal(await open(b, box), null, "another passkey cannot decrypt");
  assert.equal(await open({ id: b.id, key: again.key }, box), null, "bound to its journal id (AAD)");
  const tampered = box.slice(0, -2) + (box.endsWith("00") ? "01" : "00");
  assert.equal(await open(again, tampered), null, "tampering is detected");
  // long notes are trimmed by whole characters to fit the 512-byte entry, never split or refused
  for (const long of ["😀".repeat(400), "語".repeat(400), '"\\'.repeat(400), "a".repeat(1000)]) {
    const e2 = makeEntry({ pHash: "c3a1f00d12345678", verdict: "split", reports: 4294967295, aiVotes: 4294967295, note: long });
    assert.ok(long.startsWith(e2.n) && e2.n.length > 0);
    assert.ok(!/[\uD800-\uDBFF]$/.test(e2.n), "no half emoji");
    assert.deepEqual(await open(a, await seal(a, e2)), e2);
  }
});

test("journal on Monad: write, then a fresh 'device' reads and decrypts it", { skip, timeout: 120_000 }, async (t) => {
  const PORT = 8564, RPC = `http://127.0.0.1:${PORT}`;
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const w = (k) => createWalletClient({ account: privateKeyToAccount(k), chain: foundry, transport: http(RPC) });
  const art = JSON.parse(readFileSync(new URL("NadeyeJournal.sol/NadeyeJournal.json", OUT)));
  const owner = w("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const journal = (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi: art.abi, bytecode: art.bytecode.object }) })).contractAddress;

  const scanner = w("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const keys = await journalKeys(prf("passkey A, journal namespace"));
  for (const [p, note] of [["00000000000000aa", "first"], ["00000000000000bb", "second"]]) {
    const box = await seal(keys, makeEntry({ pHash: p, verdict: "ai", reports: 2, aiVotes: 2, note }));
    await pub.waitForTransactionReceipt({ hash: await scanner.writeContract({ address: journal, abi: journalAbi, functionName: "append", args: [keys.id, box] }) });
  }
  // fresh device: nothing but the passkey's PRF output
  const fresh = await journalKeys(prf("passkey A, journal namespace"));
  const got = await readJournal(pub, journal, fresh);
  assert.deepEqual(got.map((e) => e.n), ["second", "first"]);
  // the chain holds only ciphertext
  const raw = await pub.readContract({ address: journal, abi: journalAbi, functionName: "entries", args: [keys.id, 0n, 10n] });
  assert.ok(raw.every((b) => !Buffer.from(b.slice(2), "hex").toString("utf8").includes("first") && !Buffer.from(b.slice(2), "hex").toString("utf8").includes("second")));
  // someone else can't write into this journal
  const mallory = w("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
  // anvil account 2 is funded, so the refusal must come from the contract itself
  await assert.rejects(mallory.writeContract({ address: journal, abi: journalAbi, functionName: "append", args: [keys.id, "0x01"] }), /NotWriter/);
});
