// Sieve's preprocessing, calibration and input-quality checks, as pure
// functions over RGBA pixels. Shared by the extension's offscreen document and
// the Nadeye agent verifier (Node), so both score images identically.
// Moved verbatim from Sieve's offscreen.js; only the tensor construction is
// left to the caller (ONNX Runtime Web vs onnxruntime-node).

export function imageDataToTensor(data, C, meta) {
  const [mr, mg, mb] = meta.norm_mean;
  const [sr, sg, sb] = meta.norm_std;
  const n = C * C;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = (data[j] / 255 - mr) / sr;
    out[n + i] = (data[j + 1] / 255 - mg) / sg;
    out[2 * n + i] = (data[j + 2] / 255 - mb) / sb;
  }
  return out; // CHW float32, wrap as [1, 3, C, C]
}

// Pillow-style separable triangle (bilinear, antialiased) resampling — the
// same math as the training/eval pipeline (PIL Image.resize BILINEAR), so
// scores match the Python benchmark instead of whatever Skia version the
// browser ships. Deterministic across every browser.
export function resamplePIL(src, dw, dh) {
  const pass = (data, sw, sh, dsize, horizontal) => {
    const srcSize = horizontal ? sw : sh;
    const scale = srcSize / dsize;
    const filterscale = Math.max(scale, 1.0);
    const support = filterscale; // triangle support = 1.0 * filterscale
    const ow = horizontal ? dsize : sw;
    const oh = horizontal ? sh : dsize;
    const out = new Float32Array(ow * oh * 4);
    const bounds = [];
    for (let i = 0; i < dsize; i++) {
      const center = (i + 0.5) * scale;
      const lo = Math.max(0, Math.floor(center - support));
      const hi = Math.min(srcSize, Math.ceil(center + support));
      const w = new Float32Array(hi - lo);
      let sum = 0;
      for (let k = lo; k < hi; k++) {
        const t = Math.abs((k + 0.5 - center) / filterscale);
        const v = t < 1 ? 1 - t : 0;
        w[k - lo] = v;
        sum += v;
      }
      if (sum > 0) for (let k = 0; k < w.length; k++) w[k] /= sum;
      bounds.push([lo, w]);
    }
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const [lo, w] = bounds[horizontal ? x : y];
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < w.length; k++) {
          const j = horizontal ? (y * sw + lo + k) * 4 : ((lo + k) * sw + x) * 4;
          r += data[j] * w[k];
          g += data[j + 1] * w[k];
          b += data[j + 2] * w[k];
        }
        const o = (y * ow + x) * 4;
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
    }
    return out;
  };
  let d = pass(src.data, src.width, src.height, dw, true);
  d = pass(d, dw, src.height, dh, false);
  const clamped = new Uint8ClampedArray(dw * dh * 4);
  for (let i = 0; i < d.length; i++) clamped[i] = Math.round(d[i]);
  return { data: clamped, width: dw, height: dh };
}

export function cropRGBA(src, x0, y0, C) {
  const out = new Uint8ClampedArray(C * C * 4);
  for (let y = 0; y < C; y++) {
    const s = ((y0 + y) * src.width + x0) * 4;
    out.set(src.data.subarray(s, s + C * 4), y * C * 4);
  }
  return out;
}

// torchvision test protocol: resize shorter side -> S, center crop C, ImageNet norm.
export function preprocess(img, meta) {
  const S = meta.resize_shorter_side, C = meta.input_size;
  const scale = S / Math.min(img.width, img.height);
  const rw = Math.max(C, Math.round(img.width * scale));
  const rh = Math.max(C, Math.round(img.height * scale));
  const resized = resamplePIL(img, rw, rh);
  const data = cropRGBA(resized, Math.floor((rw - C) / 2), Math.floor((rh - C) / 2), C);
  return imageDataToTensor(data, C, meta);
}

// TTA view: native-resolution center crop — no resampling, preserves the
// pixel-grid artifacts the standard resized view destroys.
// Second view for images below the native-crop size: scale the shorter side
// straight to the crop size (a 440/384 scale jitter vs. the standard view)
// instead of skipping TTA entirely in the regime where the model is weakest
// (audit #48: profile pictures / thumbnails).
export function preprocessFit(img, meta) {
  const C = meta.input_size;
  const scale = C / Math.min(img.width, img.height);
  const rw = Math.max(C, Math.round(img.width * scale));
  const rh = Math.max(C, Math.round(img.height * scale));
  const resized = resamplePIL(img, rw, rh);
  const data = cropRGBA(resized, Math.floor((rw - C) / 2), Math.floor((rh - C) / 2), C);
  return imageDataToTensor(data, C, meta);
}

// Delivery-degradation estimate on the decoded pixels (audit #41/#42): heavy
// recompression shows as energy piling up on the 8px JPEG block grid
// (blockiness ~1.0 for clean, ~1.4 at q40, >2 when "deep-fried"); content
// upscaled far beyond its true resolution has no pixel-scale texture left,
// which shows as the mean 1px luma step falling to ~half the mean 2px step
// (d12 ~0.50 for anything interpolated up, 0.55-0.9 for native images).
// d12 replaced a Laplacian-energy ratio before v0.13.0 shipped: mean
// high-frequency energy could not tell an upscaled thumbnail from a smooth
// native AI render (19% of as-posted reddit AI images tripped it), while d12
// at 0.528 trips ~1% of native images and catches 99% of 64px and ~80% of
// 128px bicubic upscales (tools/upscale_metric_scan.py). Either regime is
// one where a verdict is not evidence-backed, so the badge shows "unsure"
// instead of "AI".
export function degradationStats(img) {
  const { data, width, height } = img;
  if (width < 24 || height < 24) return { block: 1, d12: 1 };
  const L = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const sy = Math.max(1, Math.floor(height / 192));
  let dxAll = 0, dxN = 0, dxB = 0, dxBN = 0, dyAll = 0, dyN = 0, dyB = 0, dyBN = 0, d2All = 0;
  for (let y = 1; y < height - 1; y += sy) {
    const row = y * width * 4, dn = (y + 1) * width * 4;
    let prev = L(row);
    for (let x = 1; x < width - 1; x++) {
      const i = row + x * 4;
      const c = L(i), r = L(i + 4), d = L(dn + x * 4);
      const dx = Math.abs(r - c), dy = Math.abs(d - c);
      dxAll += dx; dxN++; dyAll += dy; dyN++;
      d2All += Math.abs(r - prev);
      if (x % 8 === 7) { dxB += dx; dxBN++; }
      if (y % 8 === 7) { dyB += dy; dyBN++; }
      prev = c;
    }
  }
  const bx = dxBN ? (dxB / dxBN) / (dxAll / dxN + 1e-6) : 1;
  const by = dyBN ? (dyB / dyBN) / (dyAll / dyN + 1e-6) : 1;
  return { block: (bx + by) / 2, d12: (dxAll / dxN) / (d2All / dxN + 1e-6) };
}

export function preprocessNative(img, meta) {
  const C = meta.input_size;
  const data = cropRGBA(img, Math.floor((img.width - C) / 2), Math.floor((img.height - C) / 2), C);
  return imageDataToTensor(data, C, meta);
}

export function calibrate(logit, meta) {
  const c = meta.calibration || { temperature: 1.0, bias: 0.0 };
  const z = logit / (c.temperature || 1.0) + (c.bias || 0.0);
  return 1 / (1 + Math.exp(-z));
}

// Degenerate inputs (solid fills, pure noise) sit far outside the training
// manifold and score confident nonsense (solid black -> 0.91, RGB noise ->
// 0.99). Two cheap statistics separate them from photographs: luma variance
// is ~0 for flat fills, and adjacent-pixel correlation is ~0 for noise,
// while any real image is strongly locally correlated. No verdict is badged
// for these — there is nothing meaningful to say.
export function degenerateReason(img) {
  const { data, width, height } = img;
  const sy = Math.max(1, height >> 7); // sample ~128 rows
  let n = 0, sum = 0, sum2 = 0;
  let m = 0, sa = 0, sb = 0, sab = 0, sa2 = 0, sb2 = 0;
  for (let y = 0; y < height; y += sy) {
    const row = y * width * 4;
    let prev = -1;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++; sum += l; sum2 += l * l;
      if (prev >= 0) { m++; sa += prev; sb += l; sab += prev * l; sa2 += prev * prev; sb2 += l * l; }
      prev = l;
    }
  }
  const varL = sum2 / n - (sum / n) ** 2;
  if (varL < 4) return "flat"; // luma std < 2 of 255
  const cov = sab / m - (sa / m) * (sb / m);
  const denom = Math.sqrt(Math.max((sa2 / m - (sa / m) ** 2) * (sb2 / m - (sb / m) ** 2), 1e-9));
  if (cov / denom < 0.15) return "noise";
  return null;
}

