// Pixel-exact extension icons (16/32/48/128) from brand/nadeye-avatar.svg's 8x8 grid.
// Run: node brand/make-extension-icons.mjs  (uses sharp from agent/)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../agent/package.json", import.meta.url))("sharp");
const svg = readFileSync(new URL("nadeye-avatar.svg", import.meta.url), "utf8");
const cells = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="75\.7" height="75\.7" rx="[\d.]+" fill="(#[0-9a-f]{6})"/g)]
  .map(([, x, y, c]) => ({ col: Math.round((+x - 166.2) / 88), row: Math.round((+y - 166.2) / 88), c }));
const bg = [0x0e, 0x09, 0x1c];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const minR = Math.min(...cells.map((c) => c.row)), maxR = Math.max(...cells.map((c) => c.row));
// console.log("cells", cells.length, "rows", minR, maxR, "cols", Math.min(...cells.map(c=>c.col)), Math.max(...cells.map(c=>c.col)));
// size -> [cell px, gap px, corner radius px]
const spec = { 16: [2, 0, 2], 32: [3, 0, 4], 48: [5, 1, 6], 128: [13, 2, 14] };
for (const [size, [cell, gap, radius]] of Object.entries(spec).map(([s, v]) => [+s, v])) {
  const buf = Buffer.alloc(size * size * 4);
  const grid = 8 * cell, off = Math.floor((size - grid) / 2), offY = Math.floor((size - 6 * cell) / 2) - minR * cell;
  // rounded dark square
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
    const out = cx < radius && cy < radius && (radius - cx - 0.5) ** 2 + (radius - cy - 0.5) ** 2 > radius ** 2;
    const i = (y * size + x) * 4;
    if (!out) { buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; buf[i + 3] = 255; }
  }
  for (const { col, row, c } of cells) {
    const [r, g, b] = hex(c);
    for (let dy = 0; dy < cell - gap; dy++) for (let dx = 0; dx < cell - gap; dx++) {
      const x = off + col * cell + dx, y = offY + row * cell + dy, i = (y * size + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  await sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png().toFile(new URL(`../extension/icons/icon${size}.png`, import.meta.url).pathname);
}
