// Browser e2e for the Mera journal + session UX, in real Chromium with a virtual passkey (PRF).
// anvil (Osaka, chain 10143) stands in for Monad testnet; the site's RPC and drip URLs are routed locally.
//   cd web && npm install && npx playwright install chromium && npm run e2e
// Needs anvil on PATH, compiled contracts (forge build) and agent/ installed (for the drip and sharp).
// It rebuilds web/dist for local addresses; run `node build.mjs …` again before deploying.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import assert from "node:assert/strict";

import { fileURLToPath } from "node:url";
import * as viem from "viem";
import { privateKeyToAccount } from "viem/accounts";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { createDrip } = await import(join(ROOT, "agent/src/drip.js"));
const { createApi } = await import(join(ROOT, "agent/src/server.js"));
const SHOTS = mkdtempSync(join(tmpdir(), "nadeye-e2e-"));

const PORT = 8571, RPC = `http://127.0.0.1:${PORT}`;
const chain = { id: 10143, name: "anvil-monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "10143", "--hardfork", "osaka", "--silent"], { stdio: "ignore" });
const cleanup = [];
const done = () => { for (const f of cleanup.reverse()) try { f(); } catch {} anvil.kill(); };
process.on("exit", done);

const pub = viem.createPublicClient({ chain, transport: viem.http(RPC) });
for (let i = 0; i < 80; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const deployer = viem.createWalletClient({ account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"), chain, transport: viem.http(RPC) });
const art = (n) => JSON.parse(readFileSync(join(ROOT, `contracts/out/${n}.sol/${n}.json`)));
async function deploy(n, args = []) {
  const a = art(n);
  const hash = await deployer.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
}
const nadeye = await deploy("Nadeye", ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"]);
const passkeys = await deploy("PasskeyRegistry");
const journal = await deploy("NadeyeJournal");
console.log("deployed", { nadeye, passkeys, journal });

// agent drip, wallet = anvil account #1
const agentAcct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const agentWallet = viem.createWalletClient({ account: agentAcct, chain, transport: viem.http(RPC) });
const SITE = "http://localhost:8572";
const drip = createDrip({
  cfg: { network: "testnet", validatorMinBalanceWei: 0n, drip: { enabled: true, amount: "0.5", file: join(mkdtempSync(join(tmpdir(), "e2e-")), "d.json") } },
  pub, from: agentAcct.address, send: (to, value) => agentWallet.sendTransaction({ to, value, gas: 21000n }),
});
const api = createApi({ verifier: {}, cfg: { network: "testnet", chain, host: "127.0.0.1", allowedHosts: ["drip.test"], corsOrigins: [SITE] }, drip });
await new Promise((ok) => api.listen(8573, "127.0.0.1", ok));
cleanup.push(() => api.close());

// build the site for these addresses and serve dist/
await new Promise((ok, fail) => {
  const b = spawn("node", ["build.mjs", nadeye, "testnet", passkeys, journal, "--drip=https://drip.test/drip", "--indexer=https://indexer.test/v1/graphql"], { cwd: join(ROOT, "web"), stdio: "inherit" });
  b.on("exit", (c) => (c ? fail(new Error("build failed")) : ok()));
});
const DIST = join(ROOT, "web/dist");
const types = { ".html": "text/html", ".js": "text/javascript" };
const site = createServer((req, res) => {
  const p = join(DIST, new URL(req.url, SITE).pathname === "/" ? "index.html" : new URL(req.url, SITE).pathname);
  if (!p.startsWith(DIST) || !existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }).end(readFileSync(p));
});
await new Promise((ok) => site.listen(8572, "127.0.0.1", ok));
cleanup.push(() => site.close());

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); // CHROMIUM_PATH: use an existing Chrome/Chromium
cleanup.push(() => browser.close());
const ctx = await browser.newContext();
// Monad RPC -> anvil; drip URL -> the local agent
await ctx.route("https://testnet-rpc.monad.xyz/**", async (route) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
  await route.fulfill({ status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: await r.text() });
});
await ctx.route("https://drip.test/**", async (route) => {
  const req = route.request();
  const r = await fetch("http://127.0.0.1:8573/drip", { method: req.method(), headers: { ...req.headers(), host: "drip.test" }, body: req.method() === "POST" ? req.postData() : undefined });
  await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() });
});
// the Envio indexer's GraphQL (Hasura shape: BigInt as strings), with a hostile handle
const now = Math.floor(Date.now() / 1000), today = Math.floor(now / 86400);
let indexerUp = true, indexerQueries = 0;
const ACTIVITY = { data: {
  Totals: [{ scans: 42, scanners: 5, passkeys: 2, verifierAnswers: 3 }],
  DailyStat: [{ day: today, scans: 12, aiVotes: 7 }, { day: today - 1, scans: 30, aiVotes: 9 }],
  Attestation: [
    { timestamp: now - 30, isAI: true, consensus: 1, first: false, scanner: { id: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", handle: "<img src=x onerror=alert(2)>", passkey: true, agentId: "7" }, image: { pHash: "c3a1f00d12345678", reports: 3, aiVotes: 3, scoreSum: "28500" } },
    { timestamp: now - 4000, isAI: false, consensus: 0, first: true, scanner: { id: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", handle: null, passkey: false, agentId: null }, image: { pHash: "00000000000000aa", reports: 1, aiVotes: 0, scoreSum: "1200" } },
  ],
  VerifierAnswer: [{ timestamp: now - 90, authenticity: 3, verdict: "ai", requesterAgentId: "42", image: { pHash: "c3a1f00d12345678" } }],
} };
await ctx.route("https://indexer.test/**", async (route) => {
  indexerQueries++;
  const body = JSON.parse(route.request().postData() || "{}");
  if (!indexerUp) return route.fulfill({ status: 503, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ errors: [{ message: "down" }] }) });
  assert.match(body.query, /Attestation\(order_by: \[\{block: desc\}, \{logIndex: desc\}\]/);
  await route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(ACTIVITY) });
});
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push(String(e)));

const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
  protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true,
} });

const busyDone = async () => { await page.waitForFunction(() => !document.getElementById("ppBusy").textContent, null, { timeout: 60_000 }); };
const err = () => page.locator("#ppError").textContent();

await page.goto(SITE + "/");

// Activity tab (Envio indexer): totals, chart, feed, verifier answers, click-through, errors
await page.click('nav button[data-view="activity"]');
await page.waitForFunction(() => document.getElementById("aPasskeys").textContent === "2");
assert.equal(await page.locator("#aToday").textContent(), "12");
assert.equal(await page.locator("#aAiShare").textContent(), "38%"); // 16 AI of 42 over 14 days
assert.equal(await page.locator("#aAnswers").textContent(), "3");
assert.equal(await page.locator("#actFeed li").count(), 2);
assert.equal(await page.locator("#actFeed img").count(), 0, "a hostile handle stays text");
assert.match(await page.locator("#actFeed li").first().textContent(), /<img src=x onerror=alert\(2\)> #7 passkey voted AI · agreed with the majority/);
assert.match(await page.locator("#actAnswers li").first().textContent(), /AI-generated · asked by agent #42 · pHash c3a1f00d12345678/);
assert.match(await page.locator("#actChart .bars").getAttribute("aria-label"), /42 in total, 16 of them AI votes/);
await page.locator("#actFeed li").first().locator("button").click();
await page.waitForSelector("#view-registry:not([hidden])");
assert.match(await page.locator("#checkOut").textContent(), /3 of 3 scanners flagged it as AI/);
indexerUp = false;
await page.click('nav button[data-view="activity"]');
await page.waitForFunction(() => /Could not refresh/.test(document.getElementById("actNote").textContent));
assert.equal(await page.locator("#actFeed li").count(), 2, "a failed refresh keeps the last good data");
indexerUp = true;
await page.setViewportSize({ width: 390, height: 800 });
await page.locator("#view-activity").screenshot({ path: join(SHOTS, "activity-mobile.png") });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "activity: no horizontal scroll at phone width");
await page.setViewportSize({ width: 1100, height: 900 });
await page.locator("#view-activity").screenshot({ path: join(SHOTS, "activity.png") });
console.log("activity tab ok:", indexerQueries, "indexer queries");

await page.click('nav button[data-view="me"]');
await page.fill("#ppName", "e2e");
await page.click("#ppCreate");
await page.waitForSelector("#ppSignedIn:not([hidden])", { timeout: 60_000 });
await busyDone();
const toast1 = await page.locator("#ppToastText").textContent();
console.log("after create:", toast1);
assert.match(toast1, /Sent 0\.5 testnet MON/);
const identity = (await page.locator("#ppIdAddr a").getAttribute("href")).split("/").pop();
assert.ok((await pub.getBalance({ address: identity })) >= viem.parseEther("0.5"), "drip arrived");
assert.match(await page.locator("#ppSession").textContent(), /wiped at/);

// journal: unlock (second PRF namespace), empty
assert.equal(await page.locator("#ppJStatus").textContent(), "Locked");
await page.click("#ppJUnlock");
await busyDone();
assert.equal(await err(), "", await err());
assert.match(await page.locator("#ppJStatus").textContent(), /Unlocked · 0 entries/);

// check an image on the Registry tab and save it with a note
await page.click('nav button[data-view="registry"]');
const sharp = (await import("node:module")).createRequire(join(ROOT, "agent/package.json"))("sharp");
const raw = Buffer.alloc(128 * 128 * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + ((i / 384) | 0) * 13) & 255;
const png = await sharp(raw, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
await page.setInputFiles("#file", { name: "x.png", mimeType: "image/png", buffer: png });
await page.waitForSelector("#journalSlot input", { timeout: 30_000 }).catch(async (e) => { console.log("checkOut:", await page.locator("#checkOut").innerHTML(), logs); throw e; });
const NOTE = "<img src=x onerror=alert(1)> saw this in a thread 😀";
await page.fill("#journalSlot input", NOTE);
await page.click("#journalSlot button");
await page.waitForSelector("#journalSlot [role=status]", { timeout: 60_000 });
console.log("save:", await page.locator("#journalSlot [role=status]").textContent());
assert.match(await page.locator("#journalSlot [role=status]").textContent(), /Saved/);

// onchain: ciphertext only
const jAbi = [{ type: "function", name: "count", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] }];
const logsJ = await pub.getLogs({ address: journal, fromBlock: 0n });
assert.equal(logsJ.length, 1);
const tx = await pub.getTransaction({ hash: logsJ[0].transactionHash });
assert.ok(!Buffer.from(tx.input.slice(2), "hex").toString("latin1").includes("saw this"), "note is not in calldata");

await page.click('nav button[data-view="me"]');
assert.match(await page.locator("#ppJStatus").textContent(), /1 entry/);
assert.equal(await page.locator("#ppJList li .small").nth(1).textContent(), NOTE, "note rendered as text");
assert.equal(await page.locator("#ppJList img").count(), 0, "no HTML injected");

// signing scope: the page's own keys refuse to sign for an arbitrary contract
// (exercised via the bundled client in the unit test; here: lock wipes everything)
await page.click("#ppSignOut");
assert.ok(await page.locator("#ppSignedOut").isVisible());
assert.match(await page.locator("#ppToastText").textContent(), /wiped/);

// fresh device: no localStorage, reload, sign in with the (synced) passkey, unlock, read
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click('nav button[data-view="me"]');
await page.click("#ppLogin");
await page.waitForSelector("#ppSignedIn:not([hidden])", { timeout: 60_000 });
await busyDone();
assert.equal((await page.locator("#ppIdAddr a").getAttribute("href")).split("/").pop(), identity, "same identity on the new device");
await page.click("#ppJUnlock");
await busyDone();
assert.match(await page.locator("#ppJStatus").textContent(), /Unlocked · 1 entry/);
assert.equal(await page.locator("#ppJList li .small").nth(1).textContent(), NOTE);

await page.setViewportSize({ width: 1100, height: 900 });
await page.locator("#ppJournalPanel").scrollIntoViewIfNeeded();
await page.locator("#ppJournalPanel").screenshot({ path: join(SHOTS, "journal-panel.png") });
await page.setViewportSize({ width: 390, height: 800 });
await page.locator("#ppJournalPanel").screenshot({ path: join(SHOTS, "journal-mobile.png") });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal scroll at phone width");
// idle expiry: jump the clock past 10 minutes of inactivity
await page.evaluate(() => { const real = Date.now; const t0 = real(); Date.now = () => real() + (t0 - t0) + 11 * 60_000; });
await page.waitForSelector("#ppSignedOut:not([hidden])", { timeout: 20_000 });
assert.match(await page.locator("#ppToastText").textContent(), /10 minutes/);
await page.click('nav button[data-view="registry"]');
await page.click('nav button[data-view="me"]');
assert.ok(await page.locator("#ppJournalPanel").isHidden() || !(await page.locator("#ppSignedIn").isVisible()));

await page.screenshot({ path: join(SHOTS, "journal-e2e.png"), fullPage: true });
assert.deepEqual(logs.filter((l) => !/favicon|404|ERR_TUNNEL_CONNECTION_FAILED|status of 503/.test(l)), []);
console.log(`JOURNAL E2E PASS (screenshots in ${SHOTS})`);
await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
process.exit(0);
