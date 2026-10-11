// Wraps web/index.html in a full HTML document for static hosting
// (Vercel, Netlify, GitHub Pages): node web/build.mjs [contractAddress] [testnet|mainnet]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "index.html"), "utf8");
const [contract, network] = process.argv.slice(2);
if (contract) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error("contract must be 0x + 40 hex chars");
  src = src.replace(/contract: "0x[0-9a-fA-F]{40}"/, `contract: "${contract}"`);
}
if (network) src = src.replace(/network: "(testnet|mainnet)"/, `network: "${network}"`);
const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${src}
`;
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), out);
console.log(`web/dist/index.html written${contract ? ` for ${contract}` : " (example data until a contract is set)"}`);
