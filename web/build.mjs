// Builds the Nadeye site.
//   node web/build.mjs [nadeyeAddress] [testnet|mainnet] [passkeyRegistryAddress]
// 1. bundles src/passkey.js (Mera + viem, pinned in package.json) -> web/passkey.js
// 2. writes web/dist/ (index.html, passkey.js, ethers.umd.min.js) for static hosting
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [join(here, "src", "passkey.js")],
  bundle: true, format: "esm", platform: "browser", target: ["chrome120", "safari17"],
  minify: true, legalComments: "none", outfile: join(here, "passkey.js"), logLevel: "warning",
});

let src = readFileSync(join(here, "index.html"), "utf8");
const [contract, network, passkeys] = process.argv.slice(2);
if (contract) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error("contract must be 0x + 40 hex chars");
  src = src.replace(/contract: "0x[0-9a-fA-F]{40}"/, `contract: "${contract}"`);
}
if (network) {
  if (!/^(testnet|mainnet)$/.test(network)) throw new Error("network must be testnet or mainnet");
  src = src.replace(/network: "(testnet|mainnet)"/, `network: "${network}"`);
}
if (passkeys) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(passkeys)) throw new Error("PasskeyRegistry must be 0x + 40 hex chars");
  src = src.replace(/passkeys: "0x[0-9a-fA-F]{40}"/, `passkeys: "${passkeys}"`);
}
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${src}
`);
copyFileSync(join(here, "passkey.js"), join(here, "dist", "passkey.js"));
// ethers ships with the site (version pinned in package.json) instead of loading from a CDN
copyFileSync(join(here, "node_modules", "ethers", "dist", "ethers.umd.min.js"), join(here, "dist", "ethers.umd.min.js"));
console.log(`web/dist ready${contract ? ` for ${contract} on ${network || "the page's network"}` : " (example data until a contract is set)"}`);
