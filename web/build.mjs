// Builds the Nadeye site.
//   node web/build.mjs [nadeyeAddress] [testnet|mainnet] [passkeyRegistryAddress] [journalAddress]
//                      [--drip=https://agent/drip] [--indexer=https://indexer/v1/graphql]
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
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [contract, network, passkeys, journal] = args.filter((a) => !a.startsWith("--"));
const drip = flag("drip"), indexer = flag("indexer");
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
if (journal) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(journal)) throw new Error("NadeyeJournal must be 0x + 40 hex chars");
  src = src.replace(/journal: "0x[0-9a-fA-F]{40}"/, `journal: "${journal}"`);
}
for (const [name, value] of [["drip", drip], ["indexer", indexer]]) {
  if (!value) continue;
  if (!/^https:\/\/[^"\s]+$/.test(value)) throw new Error(`--${name} must be an https URL`);
  src = src.replace(new RegExp(`${name}: "[^"]*"`), `${name}: ${JSON.stringify(value)}`);
}
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
${src}
`);
copyFileSync(join(here, "passkey.js"), join(here, "dist", "passkey.js"));
// tab and home-screen icons: the same pixel-exact eye mark as the extension
for (const [from, to] of [["icon16.png", "favicon-16.png"], ["icon32.png", "favicon-32.png"], ["icon128.png", "apple-touch-icon.png"]]) {
  copyFileSync(join(here, "..", "extension", "icons", from), join(here, "dist", to));
}
// ethers ships with the site (version pinned in package.json) instead of loading from a CDN
copyFileSync(join(here, "node_modules", "ethers", "dist", "ethers.umd.min.js"), join(here, "dist", "ethers.umd.min.js"));
const live = src.match(/contract: "(0x[0-9a-fA-F]{40})"/)?.[1];
console.log(`web/dist ready${live && !/^0x0{40}$/.test(live) ? ` for Nadeye ${live}` : " (example data until a contract is set)"}`);
