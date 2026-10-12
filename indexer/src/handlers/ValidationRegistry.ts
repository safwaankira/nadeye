// ERC-8004 ValidationRegistry -> answers from Nadeye verifier agents. The registry is shared by
// every validator on the chain, so only responses tagged "nadeye/ai-image" are kept (and, when
// ENVIO_VERIFIER_ADDRESS is set, only that agent's). The agent attaches its report as a
// data: URI; when it decodes, the answer is linked to the judged image.
import { indexer } from "envio";
import { dailyStat, toKey, totals } from "./shared.js";

const TAG = "nadeye/ai-image";
const PREFIX = "data:application/json;base64,";
const MAX_REPORT = 16_384;

type Report = { verdict?: unknown; aiConfidence?: unknown; pHash?: unknown };

export function decodeReport(uri: string): Report | null {
  if (!uri.startsWith(PREFIX) || uri.length > MAX_REPORT) return null;
  try {
    const r = JSON.parse(Buffer.from(uri.slice(PREFIX.length), "base64").toString("utf8"));
    return r && typeof r === "object" ? (r as Report) : null;
  } catch {
    return null;
  }
}

indexer.onEvent(
  { contract: "ValidationRegistry", event: "ValidationResponse" },
  async ({ event, context }) => {
    const { validatorAddress, agentId, requestHash, response, responseURI, tag } = event.params;
    if (tag !== TAG) return;
    const only = process.env.ENVIO_VERIFIER_ADDRESS;
    if (only && validatorAddress.toLowerCase() !== only.toLowerCase()) return;

    const report = decodeReport(responseURI);
    const pHash = typeof report?.pHash === "string" && /^[0-9a-f]{16}$/i.test(report.pHash) ? report.pHash : null;
    const image = pHash ? await context.Image.get(toKey(pHash)) : undefined;
    const ts = event.block.timestamp;
    const existing = await context.VerifierAnswer.get(requestHash);

    context.VerifierAnswer.set({
      id: requestHash,
      validator: validatorAddress,
      requesterAgentId: agentId,
      authenticity: Number(response),
      verdict: typeof report?.verdict === "string" ? report.verdict.slice(0, 16) : undefined,
      aiConfidence: typeof report?.aiConfidence === "number" ? report.aiConfidence : undefined,
      image_id: image ? image.id : undefined,
      timestamp: ts,
      txHash: event.transaction.hash,
    });
    if (existing) return; // an updated answer to the same request is not a new answer

    const d = await dailyStat(context, ts);
    context.DailyStat.set({ ...d, verifierAnswers: d.verifierAnswers + 1 });
    const t = await totals(context);
    context.Totals.set({ ...t, verifierAnswers: t.verifierAnswers + 1 });
  },
);
