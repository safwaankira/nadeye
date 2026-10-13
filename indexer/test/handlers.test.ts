// Handler logic on simulated events (no network): tallies, consensus counts, passkey holders,
// agent links, and the ERC-8004 validation filter + report decoding.
import { describe, it, beforeEach } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const CHAIN = 10143;
type Hex = `0x${string}`;
const hex = (body: string) => `0x${body}` as Hex;
const [alice, bob, verifier, other] = TestHelpers.Addresses.mockAddresses;
const key = (h: string) => hex(h.padStart(64, "0"));
const IMG = key("c3a1f00d12345678");
let n = 0;
const meta = (ts = 1_791_800_000) => ({ block: { number: 100 + n, timestamp: ts }, transaction: { hash: hex((++n).toString(16).padStart(64, "0")) }, logIndex: 0 });
const attested = (scanner: Hex, score: number, first: boolean, consensus: number, points: bigint, ts?: number) => ({
  contract: "Nadeye" as const, event: "Attested" as const,
  params: { pHash: IMG, scanner, score: BigInt(score), modelVersion: 7n, first, consensus: BigInt(consensus), pointsAwarded: points },
  ...meta(ts),
});
const report = (o: object) => "data:application/json;base64," + Buffer.from(JSON.stringify(o)).toString("base64");
const answer = (validator: Hex, requestHash: Hex, uri: string, tag = "nadeye/ai-image", response = 3) => ({
  contract: "ValidationRegistry" as const, event: "ValidationResponse" as const,
  params: { validatorAddress: validator, agentId: 42n, requestHash, response: BigInt(response), responseURI: uri, responseHash: hex("00".repeat(32)), tag },
  ...meta(),
});

// "" = accept any validator that uses the tag; tests that check the filter set it themselves
beforeEach(() => { process.env.ENVIO_VERIFIER_ADDRESS = ""; });

describe("Nadeye verdicts", () => {
  it("tallies an image, its scanners, the history, the day and the totals", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [
      attested(alice, 9700, true, 0, 35n, 1_791_800_000),
      attested(bob, 9100, false, 0, 10n, 1_791_800_100),
      attested(other, 1200, false, -1, 10n, 1_791_890_000), // next UTC day, against a 2-0 AI majority
    ] } } });

    const img = await indexer.Image.getOrThrow(IMG);
    t.expect({ pHash: img.pHash, reports: img.reports, aiVotes: img.aiVotes, scoreSum: img.scoreSum, verdict: img.verdict, first: img.firstScanner_id })
      .toEqual({ pHash: "c3a1f00d12345678", reports: 3, aiVotes: 2, scoreSum: 20000n, verdict: "ai", first: alice });

    const a = await indexer.Scanner.getOrThrow(alice), o = await indexer.Scanner.getOrThrow(other);
    t.expect({ scans: a.scans, firsts: a.firsts, points: a.points, joined: a.joined }).toEqual({ scans: 1, firsts: 1, points: 35n, joined: 1_791_800_000 });
    t.expect({ signal: o.signal, noise: o.noise }).toEqual({ signal: 0, noise: 1 });

    const history = await indexer.Attestation.getAll();
    t.expect(history.map((h) => [h.scanner_id, h.isAI, h.consensus])).toEqual([[alice, true, 0], [bob, true, 0], [other, false, -1]]);

    const days = (await indexer.DailyStat.getAll()).sort((x, y) => x.day - y.day);
    t.expect(days.map((d) => [d.scans, d.aiVotes, d.newImages])).toEqual([[2, 2, 1], [1, 0, 0]]);
    t.expect(await indexer.Totals.getOrThrow("nadeye")).toMatchObject({ scans: 3, images: 1, scanners: 3 });
  });

  it("a tie is a split verdict", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [attested(alice, 9000, true, 0, 35n), attested(bob, 1000, false, 0, 10n)] } } });
    t.expect((await indexer.Image.getOrThrow(IMG)).verdict).toBe("split");
  });
});

describe("identity", () => {
  it("handles and ERC-8004 agent links, before or after the first scan", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [
      { contract: "Nadeye", event: "HandleSet", params: { scanner: alice, handle: "safwaan_uddin" }, ...meta() },
      { contract: "Nadeye", event: "AgentLinked", params: { scanner: alice, agentId: 0n }, ...meta() },
      attested(alice, 9700, true, 0, 35n),
      { contract: "Nadeye", event: "AgentLinked", params: { scanner: bob, agentId: 9n }, ...meta() },
      { contract: "Nadeye", event: "AgentUnlinked", params: { scanner: bob, agentId: 9n }, ...meta() },
    ] } } });
    const a = await indexer.Scanner.getOrThrow(alice);
    t.expect({ handle: a.handle, agentId: a.agentId, scans: a.scans }).toEqual({ handle: "safwaan_uddin", agentId: 0n, scans: 1 });
    t.expect((await indexer.Scanner.getOrThrow(bob)).agentId).toBeUndefined();
    t.expect((await indexer.Totals.getOrThrow("nadeye")).scanners).toBe(1); // only scanners that attested count
  });

  it("counts passkey holders once, through re-registration and removal", async (t) => {
    const indexer = createTestIndexer();
    const reg = (account: Hex, k: string) => ({ contract: "PasskeyRegistry" as const, event: "PasskeyRegistered" as const,
      params: { account, keyHash: hex(k.repeat(64)), x: hex("01".repeat(32)), y: hex("02".repeat(32)) }, ...meta(1_791_800_500) });
    await indexer.process({ chains: { [CHAIN]: { simulate: [
      reg(alice, "a"), reg(alice, "b"), reg(bob, "c"),
      { contract: "PasskeyRegistry", event: "PasskeyRemoved", params: { account: bob, keyHash: hex("c".repeat(64)) }, ...meta() },
      { contract: "PasskeyRegistry", event: "PasskeyRemoved", params: { account: bob, keyHash: hex("c".repeat(64)) }, ...meta() },
    ] } } });
    t.expect((await indexer.Scanner.getOrThrow(alice))).toMatchObject({ passkey: true, passkeyAt: 1_791_800_500 });
    t.expect((await indexer.Scanner.getOrThrow(bob)).passkey).toBe(false);
    t.expect((await indexer.Totals.getOrThrow("nadeye")).passkeys).toBe(1);
  });
});

describe("verifier agent answers (ERC-8004 Validation Registry)", () => {
  it("keeps only nadeye/ai-image answers, decodes the report and links the image", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [
      attested(alice, 9700, true, 0, 35n),
      answer(verifier, hex("11".repeat(32)), report({ verdict: "ai", aiConfidence: 0.97, pHash: "c3a1f00d12345678" })),
      answer(verifier, hex("22".repeat(32)), "https://example.com/report.json"),            // not a data: report
      answer(verifier, hex("33".repeat(32)), "data:application/json;base64,!!!notjson"),     // malformed
      answer(other, hex("44".repeat(32)), report({ verdict: "real" }), "some-other-tag"),     // another validator's tag
      answer(verifier, hex("11".repeat(32)), report({ verdict: "ai", aiConfidence: 0.98, pHash: "c3a1f00d12345678" })), // re-answer
    ] } } });
    const all = await indexer.VerifierAnswer.getAll();
    t.expect(all).toHaveLength(3);
    const linked = await indexer.VerifierAnswer.getOrThrow(hex("11".repeat(32)));
    t.expect({ verdict: linked.verdict, aiConfidence: linked.aiConfidence, image: linked.image_id, authenticity: linked.authenticity, requester: linked.requesterAgentId })
      .toEqual({ verdict: "ai", aiConfidence: 0.98, image: IMG, authenticity: 3, requester: 42n });
    t.expect((await indexer.VerifierAnswer.getOrThrow(hex("33".repeat(32)))).verdict).toBeUndefined();
    t.expect((await indexer.Totals.getOrThrow("nadeye")).verifierAnswers).toBe(3); // the re-answer is not a new answer
  });

  it("with ENVIO_VERIFIER_ADDRESS set, only that agent's answers count", async (t) => {
    process.env.ENVIO_VERIFIER_ADDRESS = verifier.toLowerCase();
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [
      answer(verifier, hex("55".repeat(32)), report({ verdict: "real" })),
      answer(other, hex("66".repeat(32)), report({ verdict: "ai" })),
    ] } } });
    t.expect((await indexer.VerifierAnswer.getAll()).map((a) => a.validator)).toEqual([verifier]);
  });

  it("by default, only the deployed Nadeye Verifier (#2282) counts", async (t) => {
    delete process.env.ENVIO_VERIFIER_ADDRESS;
    const real = hex("11B8524Cb25E6B2000a644ac7C9B4bcfdf064B5F");
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [
      answer(real, hex("77".repeat(32)), report({ verdict: "ai" })),
      answer(other, hex("88".repeat(32)), report({ verdict: "real" })),
    ] } } });
    t.expect((await indexer.VerifierAnswer.getAll()).map((a) => a.validator.toLowerCase())).toEqual([real.toLowerCase()]);
  });
});
