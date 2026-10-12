// Sieve's detector in Node: the same pinned weights, the same preprocessing
// code as the extension (extension/src/pipeline.js), run by onnxruntime-node.
// On an M-series Mac the CPU provider scores an image in well under a second.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ort from "onnxruntime-node";
import sharp from "sharp";
import { sniffMetadata } from "../../extension/src/forensics.js";
import { preprocess, preprocessFit, preprocessNative, degradationStats, calibrate, degenerateReason } from "../../extension/src/pipeline.js";
import { pHashDetail, lookupCandidates } from "../../extension/src/phash.js";

const here = dirname(fileURLToPath(import.meta.url));
export const MANIFEST = JSON.parse(readFileSync(join(here, "../../extension/model_manifest.json"), "utf8"));

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** download the pinned weights once, verify the checksum, cache them */
export async function ensureModel({ cacheDir, modelPath }) {
  if (modelPath) {
    if (sha256(readFileSync(modelPath)) !== MANIFEST.sha256) throw new Error(`${modelPath} does not match the pinned sha256`);
    return modelPath;
  }
  const path = join(cacheDir, `model-${MANIFEST.version}.onnx`);
  if (existsSync(path)) return path;
  mkdirSync(cacheDir, { recursive: true });
  process.stderr.write(`Downloading Sieve weights ${MANIFEST.version} (~45 MB, once)…\n`);
  const resp = await fetch(MANIFEST.model_url);
  if (!resp.ok) throw new Error(`model download failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (sha256(buf) !== MANIFEST.sha256) throw new Error("model checksum mismatch, refusing to use it");
  writeFileSync(path + ".part", buf);
  renameSync(path + ".part", path);
  return path;
}

/** decode to RGBA at native size; no EXIF rotation, matching Sieve's PIL reference */
export async function decodeRGBA(buf) {
  const { data, info } = await sharp(buf, { failOn: "none", limitInputPixels: 80_000_000 })
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

export async function createDetector(opts) {
  const path = await ensureModel(opts);
  const session = await ort.InferenceSession.create(path, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  const meta = MANIFEST;
  const C = meta.input_size;
  const inputName = session.inputNames[0], outputName = session.outputNames[0];
  let chain = Promise.resolve(); // one inference at a time

  const logit = (chw) => {
    const run = () => session.run({ [inputName]: new ort.Tensor("float32", chw, [1, 3, C, C]) })
      .then((o) => Number(o[outputName].data[0]));
    const p = chain.then(run, run);
    chain = p.then(() => {}, () => {});
    return p;
  };

  /**
   * Score an image buffer exactly like the extension: metadata forensics,
   * input-quality checks, standard view, selective TTA, calibration.
   * `{ tta: false }` returns the single standard view (for parity tests).
   */
  async function score(buf, { tta = true } = {}) {
    const t0 = performance.now();
    const md = sniffMetadata(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    const img = await decodeRGBA(buf);
    const ph = pHashDetail(img);
    const base = { phash: ph.hex, phashNear: lookupCandidates(ph), width: img.width, height: img.height, model: meta.version };
    if (md.hit) return { ...base, score: 0.99, reason: md.reason, evidence: "metadata", degraded: false, tta: false, ms: Math.round(performance.now() - t0) };
    if (img.width < 32 || img.height < 32) throw new Error("too-small");
    const degen = degenerateReason(img);
    if (degen) throw new Error(`degenerate-${degen}`);
    const dq = degradationStats(img);
    const degraded = dq.block >= 1.8 || dq.d12 < 0.528;
    const zStd = await logit(preprocess(img, meta));
    let z = zStd, used = false;
    const cfg = meta.tta || {};
    if (tta && cfg.enabled) {
      const s = calibrate(zStd, meta);
      const large = Math.min(img.width, img.height) >= (cfg.min_side || C);
      if (s >= cfg.band_lo && s <= cfg.band_hi && (large || cfg.small_view !== false)) {
        z = (zStd + (await logit(large ? preprocessNative(img, meta) : preprocessFit(img, meta)))) / 2;
        used = true;
      }
    }
    return { ...base, score: calibrate(z, meta), evidence: "model", degraded, tta: used,
      quality: { block: +dq.block.toFixed(3), d12: +dq.d12.toFixed(4) }, ms: Math.round(performance.now() - t0) };
  }

  return { score, meta, threshold: 0.65 };
}

/** human-readable verdict with the same bands as the extension badge */
export function verdictOf(r, threshold = 0.65) {
  if (r.degraded && r.score >= threshold) return "unsure";
  if (r.score >= threshold) return "ai";
  if (r.score >= 0.5) return "unsure";
  return "real";
}
