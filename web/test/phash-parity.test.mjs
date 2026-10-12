// The site hashes dropped images with an inline copy of the extension's pHash (index.html has
// no build step for it). If the two drift, the site stops finding what the extension recorded,
// so they must agree bit for bit, including the near-variant candidates used for lookups.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pHashDetail, lookupCandidates, toKey } from "../../extension/src/phash.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("// pHash, kept identical to extension/src/phash.js");
const end = html.indexOf("\n", html.indexOf("const toKey = (hex)", start));
const site = new Function(`${html.slice(start, end)}\nreturn { pHashDetail, candidates, toKey };`)();

function image(seed, width, height) {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const data = new Uint8ClampedArray(width * height * 4);
  const fx = r() * 0.2, fy = r() * 0.2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, v = 128 + 100 * Math.sin(x * fx + y * fy) + 27 * (r() - 0.5);
    data[i] = v; data[i + 1] = 255 - v; data[i + 2] = (x * y) & 255; data[i + 3] = 255;
  }
  return { data, width, height };
}

test("the site's inline pHash matches the extension's, bit for bit", () => {
  for (const [seed, w, h] of [[1, 64, 64], [2, 640, 480], [3, 33, 997], [4, 1200, 50], [5, 257, 255]]) {
    const img = image(seed, w, h);
    const a = pHashDetail(img), b = site.pHashDetail(img);
    assert.equal(b.hex, a.hex, `hash for ${w}x${h}`);
    assert.deepEqual(site.candidates(b), lookupCandidates(a), `lookup candidates for ${w}x${h}`);
    assert.equal(site.toKey(b.hex), toKey(a.hex));
  }
});
