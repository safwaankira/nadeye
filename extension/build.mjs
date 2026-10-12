// Copies the ONNX Runtime Web runtime from node_modules into the extension.
// Everything the extension runs ships inside the extension directory —
// no CDN, no remote code.
import { cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "node_modules", "onnxruntime-web", "dist");
const dst = join(here, "vendor", "ort");

// Only the files Sieve actually loads. offscreen.html statically loads the
// webgpu (jsep) bundle, which lazily requests exactly its matching wasm pair.
// The forced-WASM path in the test suite (mode-test.mjs) proves the wasm
// fallback works from this exact set — extend the list only with test cover.
const KEEP = [
  "ort.webgpu.min.js",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
let bytes = 0;
for (const f of KEEP) {
  cpSync(join(src, f), join(dst, f));
  bytes += statSync(join(dst, f)).size;
}
console.log(`vendored ${KEEP.length} ONNX Runtime Web files (${(bytes / 1e6).toFixed(1)}MB) -> vendor/ort/`);

// Nadeye: bundle the Monad chain client (viem) into one ES module the
// service worker imports. Still no remote code: everything ships in the
// extension directory.
const { build } = await import("esbuild");
await build({
  entryPoints: [join(here, "src", "chain", "index.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome124",
  minify: true,
  legalComments: "linked",
  outfile: join(here, "src", "chain.bundle.js"),
  logLevel: "warning",
});
console.log(`bundled chain client -> src/chain.bundle.js (${(statSync(join(here, "src", "chain.bundle.js")).size / 1e3).toFixed(0)}KB)`);
