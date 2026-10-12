// One verification = local model verdict + Nadeye community verdict.
// Shared by the HTTP API, the MCP tool and the ERC-8004 validator.
import { fetchImageBytes } from "./safefetch.js";
import { verdictOf } from "./detector.js";
import { modelVersionByte } from "./chain.js";

export function createVerifier({ detector, chain, cfg }) {
  const mv = modelVersionByte(detector.meta.version);

  async function verifyBytes(buf, { source = null, attest = false } = {}) {
    const r = await detector.score(buf);
    let community = null, attestTx = null, communityError = null;
    try { community = await chain.community(r.phashNear); } catch (e) { communityError = String(e.shortMessage || e.message || e); }
    if (attest && !r.degraded) {
      try { attestTx = await chain.attest(r.phash, r.score, mv); } catch (e) { communityError = String(e.shortMessage || e.message || e); }
    }
    const verdict = verdictOf(r, detector.threshold);
    return {
      source,
      verdict,                                   // "ai" | "real" | "unsure"
      aiConfidence: +r.score.toFixed(4),         // 0..1, calibrated; flagged at >= 0.65
      authenticity: Math.round((1 - r.score) * 100), // 0..100, the ERC-8004 validation response
      evidence: r.evidence,                      // "model" | "metadata" (C2PA / generator tags)
      reason: r.reason || null,
      degraded: r.degraded,
      pHash: r.phash,
      community,                                 // onchain verdicts from Nadeye scanners
      communityError,
      attestTx,
      model: { name: "Sieve (ViT-S/16, Community Forensics fine-tune)", version: r.model, tta: r.tta, ms: r.ms },
      network: cfg.network,
      contract: cfg.contract,
    };
  }

  async function verifyUrl(url, opts = {}) {
    const buf = await fetchImageBytes(url, { allowPrivate: cfg.allowPrivate });
    return verifyBytes(buf, { ...opts, source: url });
  }

  return { verifyBytes, verifyUrl };
}
