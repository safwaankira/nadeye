// Nadeye.sol events -> verdict history, per-image tallies and scanner records.
import { indexer } from "envio";
import { AI_VOTE_BPS, majority, scannerOrNew, shortHash, totals, dailyStat } from "./shared.js";

indexer.onEvent(
  { contract: "Nadeye", event: "Attested" },
  async ({ event, context }) => {
    const { pHash, scanner: scannerId, score, modelVersion, first, consensus, pointsAwarded } = event.params;
    const ts = event.block.timestamp;
    const isAI = Number(score) >= AI_VOTE_BPS;

    const image = (await context.Image.get(pHash)) ?? {
      id: pHash, pHash: shortHash(pHash), reports: 0, aiVotes: 0, scoreSum: 0n, verdict: "real",
      firstScanner_id: scannerId, firstSeen: ts, lastSeen: ts,
    };
    const reports = image.reports + 1, aiVotes = image.aiVotes + (isAI ? 1 : 0);
    context.Image.set({ ...image, reports, aiVotes, scoreSum: image.scoreSum + BigInt(score), verdict: majority(reports, aiVotes), lastSeen: ts });

    const s = await scannerOrNew(context, scannerId);
    const joinedNow = s.scans === 0;
    context.Scanner.set({
      ...s,
      scans: s.scans + 1,
      firsts: s.firsts + (first ? 1 : 0),
      signal: s.signal + (Number(consensus) === 1 ? 1 : 0),
      noise: s.noise + (Number(consensus) === -1 ? 1 : 0),
      points: s.points + pointsAwarded,
      joined: joinedNow ? ts : s.joined,
      lastSeen: ts,
    });

    context.Attestation.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      image_id: pHash, scanner_id: scannerId,
      score: Number(score), isAI, first, consensus: Number(consensus), points: pointsAwarded,
      modelVersion: Number(modelVersion), timestamp: ts, block: event.block.number, logIndex: event.logIndex, txHash: event.transaction.hash,
    });

    const d = await dailyStat(context, ts);
    context.DailyStat.set({ ...d, scans: d.scans + 1, aiVotes: d.aiVotes + (isAI ? 1 : 0), newImages: d.newImages + (first ? 1 : 0) });
    const t = await totals(context);
    context.Totals.set({ ...t, scans: t.scans + 1, images: t.images + (first ? 1 : 0), scanners: t.scanners + (joinedNow ? 1 : 0) });
  },
);

indexer.onEvent({ contract: "Nadeye", event: "HandleSet" }, async ({ event, context }) => {
  const s = await scannerOrNew(context, event.params.scanner);
  context.Scanner.set({ ...s, handle: event.params.handle || undefined });
});

indexer.onEvent({ contract: "Nadeye", event: "AgentLinked" }, async ({ event, context }) => {
  const s = await scannerOrNew(context, event.params.scanner);
  context.Scanner.set({ ...s, agentId: event.params.agentId });
});

indexer.onEvent({ contract: "Nadeye", event: "AgentUnlinked" }, async ({ event, context }) => {
  const s = await scannerOrNew(context, event.params.scanner);
  context.Scanner.set({ ...s, agentId: undefined });
});
