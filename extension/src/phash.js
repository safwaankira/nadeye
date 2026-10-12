// 64-bit DCT perceptual hash (pHash) of decoded RGBA pixels.
//
// This is the only thing about an image Nadeye ever puts onchain. It is a
// one-way 64-bit summary of coarse brightness structure: enough to recognise
// the same picture after resizing or JPEG recompression, far too little to
// reconstruct it.
//
// Steps: luma -> area-average down to 32x32 -> 2D DCT-II -> keep the 8x8
// lowest frequencies -> bit = coefficient > median (DC term excluded from the
// median). Pure JS, deterministic across browsers.

const N = 32;
const K = 8;

// cos table for the DCT, built once
const COS = (() => {
  const t = new Float64Array(K * N);
  for (let u = 0; u < K; u++)
    for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  return t;
})();

function lumaGrid(img) {
  const { data, width, height } = img;
  const out = new Float64Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    const y0 = Math.floor((gy * height) / N), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / N));
    for (let gx = 0; gx < N; gx++) {
      const x0 = Math.floor((gx * width) / N), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / N));
      // sample at most ~8x8 pixels per cell: plenty for an area average, and
      // keeps 4K images fast
      const sy = Math.max(1, Math.floor((y1 - y0) / 8)), sx = Math.max(1, Math.floor((x1 - x0) / 8));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += sy) {
        const row = y * width * 4;
        for (let x = x0; x < x1; x += sx) {
          const i = row + x * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      out[gy * N + gx] = sum / n;
    }
  }
  return out;
}

/** @returns {string} 16 lowercase hex chars (64 bits) */
export function pHash64(img) {
  return pHashDetail(img).hex;
}

/**
 * Hash plus the order of its least-stable bits (smallest distance from the
 * median). Resizing/recompression flips bits, and it is almost always these.
 */
export function pHashDetail(img) {
  const g = lumaGrid(img);
  // separable DCT, only the K lowest frequencies in each direction
  const rows = new Float64Array(N * K);
  for (let y = 0; y < N; y++)
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += g[y * N + x] * COS[u * N + x];
      rows[y * K + u] = s;
    }
  const coef = new Float64Array(K * K);
  for (let v = 0; v < K; v++)
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y * K + u] * COS[v * N + y];
      coef[v * K + u] = s;
    }
  const ac = Array.from(coef.subarray(1)).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let v = 0;
    for (let b = 0; b < 4; b++) v = (v << 1) | (coef[nib * 4 + b] > median ? 1 : 0);
    hex += v.toString(16);
  }
  const weak = Array.from({ length: 64 }, (_, i) => i)
    .sort((a, b) => Math.abs(coef[a] - median) - Math.abs(coef[b] - median));
  return { hex, weak };
}

function flip(hex, bit) {
  const nib = bit >> 2, mask = 8 >> (bit & 3);
  return hex.slice(0, nib) + (parseInt(hex[nib], 16) ^ mask).toString(16) + hex.slice(nib + 1);
}

/**
 * Registry lookup candidates: the hash itself, then every 1- and 2-bit flip
 * among its `k` least-stable bits (1 + k + k(k-1)/2 keys; 37 for k = 8).
 * The extension asks the contract for all of them in one eth_call and merges
 * the hits, so a re-encoded copy still finds the original's verdicts.
 */
export function lookupCandidates({ hex, weak }, k = 8) {
  const w = weak.slice(0, k);
  const out = [hex];
  for (let i = 0; i < w.length; i++) {
    const a = flip(hex, w[i]);
    out.push(a);
    for (let j = i + 1; j < w.length; j++) out.push(flip(a, w[j]));
  }
  return out;
}

/** pHash hex -> bytes32 key used by the Nadeye contract */
export function toKey(hex) {
  return "0x" + hex.padStart(64, "0");
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
