// Onchain vote bands: only confident scores are queued for attestation.
import test from "node:test";
import assert from "node:assert/strict";
import { createChain } from "../src/chain/index.js";
import { isRecordable } from "../src/chain/config.js";

function memStore() {
  const m = {};
  return {
    async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in m) o[k] = m[k]; return o; },
    async set(o) { Object.assign(m, o); },
    async remove(keys) { for (const k of [].concat(keys)) delete m[k]; },
  };
}
const keyOf = (i) => "0x" + i.toString(16).padStart(64, "0");

test("band edges match the contract", () => {
  assert.ok(isRecordable(4999));
  assert.ok(!isRecordable(5000));
  assert.ok(!isRecordable(6500)); // flagged by the badge, not an onchain vote
  assert.ok(!isRecordable(7999));
  assert.ok(isRecordable(8000));
});

test("unsure scores are never queued", async () => {
  const c = createChain({ store: memStore(), network: "testnet" });
  const n = await c.enqueue([
    { key: keyOf(1), score: 0.95 },
    { key: keyOf(2), score: 0.70 },
    { key: keyOf(3), score: 0.10 },
    { key: keyOf(4), score: 0.50 },
    { key: keyOf(5), score: 0.7999 },
  ]);
  assert.equal(n, 2);
});
