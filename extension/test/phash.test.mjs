// pHash must survive what the web does to images (resizing, recompression)
// and still separate different pictures.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { pHash64, hamming, toKey } from "../src/phash.js";

// a procedurally generated "photo": smooth gradients, blobs and fine texture
function scene(seed, w = 640, h = 480) {
  const buf = Buffer.alloc(w * h * 3);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const blobs = Array.from({ length: 7 }, () => ({ x: rnd() * w, y: rnd() * h, r: 40 + rnd() * 160, c: [rnd(), rnd(), rnd()].map((v) => v * 255) }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let col = [(x / w) * 120, (y / h) * 120, 80];
      for (const b of blobs) {
        const d = Math.hypot(x - b.x, y - b.y);
        if (d < b.r) col = col.map((v, i) => v * 0.4 + b.c[i] * 0.6 * (1 - d / b.r) + v * 0.6 * (d / b.r) * 0);
      }
      const n = (rnd() - 0.5) * 18;
      const o = (y * w + x) * 3;
      buf[o] = col[0] + n; buf[o + 1] = col[1] + n; buf[o + 2] = col[2] + n;
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } });
}

async function hashOf(img) {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return pHash64({ data, width: info.width, height: info.height });
}
const reencode = async (img, transform) => sharp(await transform(img).toBuffer());

test("same image survives resize + JPEG recompression", async () => {
  for (const seed of [1, 7, 42, 1337]) {
    const base = await scene(seed).png().toBuffer();
    const h0 = await hashOf(sharp(base));
    const half = await hashOf(await reencode(sharp(base), (i) => i.resize(320).jpeg({ quality: 60 })));
    const tiny = await hashOf(await reencode(sharp(base), (i) => i.resize(200).jpeg({ quality: 40 })));
    const webp = await hashOf(await reencode(sharp(base), (i) => i.webp({ quality: 50 })));
    for (const h of [half, tiny, webp]) assert.ok(hamming(h0, h) <= 6, `seed ${seed}: distance ${hamming(h0, h)}`);
  }
});

test("different images are far apart", async () => {
  const hs = await Promise.all([3, 9, 27, 81, 243].map(async (s) => hashOf(sharp(await scene(s).png().toBuffer()))));
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) assert.ok(hamming(hs[i], hs[j]) >= 12, `${i},${j}: ${hamming(hs[i], hs[j])}`);
});

test("key format is a bytes32", async () => {
  const h = await hashOf(sharp(await scene(5).png().toBuffer()));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.match(toKey(h), /^0x0{48}[0-9a-f]{16}$/);
});
