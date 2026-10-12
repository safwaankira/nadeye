// Validator spend limits: per-requester hourly cap, and a wallet floor that defers (not drops) answers.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createValidator } from "../src/validator.js";

function rig({ balance, maxPerHour = 2, minBalanceWei = 10n ** 16n }) {
  const sent = [];
  const chain = {
    account: { address: "0x00000000000000000000000000000000000000a1" },
    pub: {
      readContract: async () => ["0x00000000000000000000000000000000000000a1", 0n, 0n, "0x" + "0".repeat(64), ""],
      getBalance: async () => balance.value,
    },
    send: async (...args) => { sent.push(args); return { transactionHash: "0x" + String(sent.length).padStart(64, "0") }; },
  };
  const verifier = { verifyUrl: async () => ({ verdict: "real", aiConfidence: 0.1, authenticity: 90, evidence: "model", degraded: false, pHash: "00", community: null, model: { version: "t" } }) };
  const cfg = { cacheDir: mkdtempSync(join(tmpdir(), "nv-")), network: "test", validation: "0x00000000000000000000000000000000000000b2", contract: null, validatorMaxPerHour: maxPerHour, validatorMinBalanceWei: minBalanceWei };
  return { v: createValidator({ cfg, chain, verifier, log: () => {} }), sent };
}
const req = (i, agentId = 7n) => ({ requestHash: "0x" + i.toString(16).padStart(64, "0"), requestURI: "https://example.com/a.png", agentId });

test("one requesting agent gets at most N answers per hour", async () => {
  const { v, sent } = rig({ balance: { value: 10n ** 18n } });
  for (let i = 1; i <= 5; i++) await v.handle(req(i));
  assert.equal(sent.length, 2);
  assert.match(v.state.done[req(3).requestHash], /skipped: agent 7 over 2/);
  await v.handle(req(9, 8n)); // a different agent is not affected
  assert.equal(sent.length, 3);
});

test("below the wallet floor, answers are deferred and sent after a top-up", async () => {
  const balance = { value: 10n ** 15n }; // 0.001 MON, under the 0.01 floor
  const { v, sent } = rig({ balance });
  await v.handle(req(1));
  assert.equal(sent.length, 0);
  assert.ok(v.state.deferred[req(1).requestHash], "deferred, not dropped");
  assert.equal(v.state.done[req(1).requestHash], undefined);
  balance.value = 10n ** 18n;
  await v.handle({ ...v.state.deferred[req(1).requestHash], agentId: 7n });
  assert.equal(sent.length, 1);
  assert.equal(v.state.deferred[req(1).requestHash], undefined);
});
