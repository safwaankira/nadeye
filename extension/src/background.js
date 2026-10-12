// Service worker: orchestrates analysis requests from content scripts.
// Inference itself runs in the offscreen document (WebGPU/WASM live there).
// Nadeye adds the Monad layer: community-verdict lookups and (opt-in)
// batched attestations of local verdicts, keyed by perceptual hash.

import { createChain, AUTO_FLUSH_AT, SITE_ORIGINS, NETWORKS } from "./chain.bundle.js";

const OFFSCREEN_URL = "src/offscreen.html";

const cache = new Map(); // url -> {score, ms, tta}
const CACHE_MAX = 3000;
const inflight = new Map(); // url -> Promise

// The installed weights' version (OPFS meta): cache entries are only valid
// for the model that produced them.
async function installedModelVersion() {
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("model_meta.json");
    return JSON.parse(await (await fh.getFile()).text()).version || null;
  } catch {
    return null;
  }
}

// The in-memory cache dies with every MV3 service-worker restart; mirror it in
// session storage (survives restarts, cleared when the browser closes) so
// features like report-prefill still know recent verdicts. The mirror is
// stamped with the model version that produced it: restoring scores from an
// older model would resurrect stale verdicts across SW restarts (the bug
// behind immortal wrong badges — a cache.clear() alone doesn't reach the
// mirror).
async function restoreCacheMirror() {
  try {
    const [d, ver] = await Promise.all([
      chrome.storage.session.get(["aidCache", "aidCacheVer"]),
      installedModelVersion(),
    ]);
    // no stamp = written by pre-0.8.2 code or unknown provenance: drop it too
    if (!d.aidCacheVer || (ver && d.aidCacheVer !== ver)) {
      await chrome.storage.session.remove(["aidCache", "aidCacheVer"]).catch(() => {});
      return;
    }
    for (const [k, v] of d.aidCache || []) if (!cache.has(k)) cache.set(k, v);
  } catch {}
}
restoreCacheMirror();
// e2e hooks
globalThis.__aidRestoreCacheMirror = restoreCacheMirror;
globalThis.__aidCacheDump = () => [...cache.entries()];
let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const ver = await installedModelVersion();
    chrome.storage.session.set({
      aidCache: [...cache.entries()].slice(-1000),
      aidCacheVer: ver,
    }).catch(() => {});
  }, 2000);
}

// Report-path lookup: exact URL, else same asset ignoring the query string
// (CDNs serve size variants like twitter's ?name=small/large).
function cacheLookup(url) {
  if (cache.has(url)) return cache.get(url);
  const base = url.split("?")[0];
  for (const [k, v] of cache) {
    if (k.split("?")[0] === base) return v;
  }
  return null;
}

let offscreenReady = null;

async function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const has = await chrome.offscreen.hasDocument();
      if (!has) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ["WORKERS"],
          justification: "Runs local ML inference (ONNX Runtime Web, WebGPU/WASM) on images.",
        });
      }
    })();
  }
  return offscreenReady;
}

function cachePut(url, result) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(url, result);
  schedulePersist();
}

async function analyze(url) {
  if (cache.has(url)) return cache.get(url);
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    await ensureOffscreen();
    const resp = await chrome.runtime.sendMessage({ kind: "aid:infer", url });
    if (resp && resp.ok) {
      const result = { score: resp.score, ms: resp.ms, tta: !!resp.tta, degraded: !!resp.degraded, quality: resp.quality || null, phash: resp.phash || null, phashNear: resp.phashNear || null };
      cachePut(url, result);
      contribute(result); // Nadeye: queue for onchain attestation (opt-in)
      return result;
    }
    return { error: resp ? resp.error : "no response" };
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// ------------------------------------------------------------- Nadeye

const PP_DEFAULTS = { ppContribute: false, ppNetwork: "mainnet" };
let ppSettings = { ...PP_DEFAULTS };
let chainInst = null;
const chainStore = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

async function loadPPSettings() {
  ppSettings = await chrome.storage.sync.get(PP_DEFAULTS);
  return ppSettings;
}
const ppReady = loadPPSettings();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ppCustom) { chainInst = null; communityCache.clear(); }
  if (area !== "sync") return;
  if (changes.ppNetwork) chainInst = null;
  if (changes.ppNetwork || changes.ppContribute) loadPPSettings();
  if (changes.ppNetwork) communityCache.clear();
});

// Optional per-network override set on the options page (a fresh deployment,
// a private RPC) — no rebuild needed: ppCustom = {testnet: {contract, rpcUrl}}
async function siteOrigins() {
  const { ppSiteOrigins } = await chrome.storage.sync.get(["ppSiteOrigins"]);
  return Array.isArray(ppSiteOrigins) && ppSiteOrigins.length ? ppSiteOrigins : SITE_ORIGINS;
}

async function chain() {
  await ppReady;
  if (!chainInst) {
    const { ppCustom } = await chrome.storage.local.get(["ppCustom"]);
    const o = (ppCustom || {})[ppSettings.ppNetwork] || {};
    const override = {};
    if (o.contract) override.contract = o.contract;
    if (o.rpcUrl) override.rpcUrl = o.rpcUrl;
    chainInst = createChain({ store: chainStore, network: ppSettings.ppNetwork, override });
  }
  return chainInst;
}

// 8-bit fingerprint of the installed weights version, recorded with each
// attestation so verdicts from different models can be told apart.
async function modelVersionByte() {
  const v = (await installedModelVersion()) || "unknown";
  let h = 0x811c9dc5;
  for (const c of v) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h & 0xff;
}

async function contribute(result) {
  try {
    await ppReady;
    // only evidence-backed verdicts go onchain: degraded inputs show as
    // "unsure" locally and are not attested
    if (!ppSettings.ppContribute || !result.phash || result.degraded) return;
    const c = await chain();
    if (!c.configured()) return;
    const n = await c.enqueue([{ key: "0x" + result.phash.padStart(64, "0"), score: result.score }]);
    if (n >= AUTO_FLUSH_AT) flushQueue();
  } catch (e) {
    console.warn("Nadeye enqueue failed", e);
  }
}

async function flushQueue() {
  try {
    const c = await chain();
    const r = await c.flush(await modelVersionByte());
    if (r.sent) console.info(`Nadeye: attested ${r.sent} verdicts (${r.hash})`);
    return r;
  } catch (e) {
    console.warn("Nadeye flush failed", e);
    return { sent: 0, reason: String(e?.shortMessage || e?.message || e) };
  }
}

chrome.alarms.create("pp-flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "pp-flush") flushQueue(); });

// Community verdicts: content scripts ask per image; lookups are coalesced
// into one getImages eth_call every 250ms and cached for 5 minutes.
const communityCache = new Map(); // key -> {at, v}
const COMMUNITY_TTL = 5 * 60_000;
let pendingLookups = new Map(); // key -> [resolve]
let lookupTimer = null;

const toKey = (hex) => "0x" + hex.padStart(64, "0");

// `near` = the hash plus its likely bit-flip neighbours (see phash.js), so a
// resized/recompressed copy still finds the verdicts attested for the original.
function communityLookup(phash, near) {
  const hit = communityCache.get(phash);
  if (hit && Date.now() - hit.at < COMMUNITY_TTL) return Promise.resolve(hit.v);
  return new Promise((resolve) => {
    if (!pendingLookups.has(phash)) pendingLookups.set(phash, { keys: (near && near.length ? near : [phash]).map(toKey), waiters: [] });
    pendingLookups.get(phash).waiters.push(resolve);
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(runLookups, 250);
  });
}

async function runLookups() {
  const batch = pendingLookups;
  pendingLookups = new Map();
  const all = [...new Set([...batch.values()].flatMap((b) => b.keys))];
  const res = {};
  let ok = true;
  try {
    const c = await chain();
    for (let i = 0; i < all.length; i += 400) Object.assign(res, await c.lookup(all.slice(i, i + 400)));
  } catch (e) {
    ok = false;
    console.warn("Nadeye lookup failed", e);
  }
  for (const [phash, { keys, waiters }] of batch) {
    let reports = 0, aiVotes = 0, sum = 0;
    for (const k of keys) {
      const r = res[k];
      if (!r || !r.reports) continue;
      reports += r.reports; aiVotes += r.aiVotes; sum += r.meanScore * r.reports;
    }
    const v = reports ? { reports, aiVotes, meanScore: sum / reports } : null;
    if (ok && Object.keys(res).length) communityCache.set(phash, { at: Date.now(), v });
    for (const w of waiters) w(v);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.kind?.startsWith("pp:")) return false;
  (async () => {
    try {
      switch (msg.kind) {
        case "pp:community":
          return sendResponse(msg.phash ? await communityLookup(msg.phash, msg.near) : null);
        case "pp:status": {
          const c = await chain();
          return sendResponse({ ok: true, settings: ppSettings, ...(await c.status()) });
        }
        case "pp:flush":
          return sendResponse(await flushQueue());
        case "pp:set-handle": {
          const c = await chain();
          return sendResponse({ ok: true, hash: await c.setHandle(msg.handle) });
        }
        case "pp:export-key": {
          const c = await chain();
          return sendResponse({ ok: true, key: await c.exportKey() });
        }
        case "pp:import-key": {
          const c = await chain();
          return sendResponse({ ok: true, address: await c.importKey(msg.key) });
        }
        case "pp:site-origins":
          return sendResponse({ ok: true, origins: await siteOrigins() });
        case "pp:site-import-key": {
          // from the passkey site, relayed by the content script after the
          // user confirmed; only accepted from a trusted origin's tab
          const origin = sender?.origin || (sender?.url ? new URL(sender.url).origin : null);
          if (!origin || !(await siteOrigins()).includes(origin)) return sendResponse({ ok: false, error: "untrusted origin" });
          const c = await chain();
          const address = await c.importKey(msg.key);
          return sendResponse({ ok: true, address });
        }
        case "pp:site-scanner": {
          const origin = sender?.origin || (sender?.url ? new URL(sender.url).origin : null);
          if (!origin || !(await siteOrigins()).includes(origin)) return sendResponse({ ok: false, error: "untrusted origin" });
          const c = await chain();
          return sendResponse({ ok: true, address: (await c.account()).address, network: ppSettings.ppNetwork });
        }
        default:
          return sendResponse({ ok: false, error: "unknown" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.shortMessage || e?.message || e) });
    }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.kind === "aid:analyze") {
    analyze(msg.url).then(sendResponse);
    return true; // async
  }
  if (msg?.kind === "aid:get-settings") {
    // offscreen documents lack chrome.storage; serve settings from here
    chrome.storage.sync.get({ forceWasm: false }, sendResponse);
    return true;
  }
  if (msg?.kind === "aid:model-status") {
    (async () => {
      await ensureOffscreen();
      const resp = await chrome.runtime.sendMessage({ kind: "aid:status" });
      sendResponse(resp);
    })();
    return true;
  }
  if (msg?.kind === "aid:model-updated") {
    // Setup page stored a (new) model; offscreen must reload its session.
    (async () => {
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ kind: "aid:reload-model" });
      cache.clear();
      // reach the session-storage mirror too, or the next SW restart
      // resurrects scores produced by the previous model
      await chrome.storage.session.remove(["aidCache", "aidCacheVer"]).catch(() => {});
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});

// The model in OPFS may predate the manifest bundled with this build:
// extension updates ship a new pinned model URL, but the download itself
// stays user-initiated (setup page), so detect the mismatch and prompt.
async function modelOutdated() {
  try {
    const bundled = await (await fetch(chrome.runtime.getURL("model_manifest.json"))).json();
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("model_meta.json");
    const meta = JSON.parse(await (await fh.getFile()).text());
    return !!bundled.version && meta.version !== bundled.version;
  } catch {
    return false; // nothing stored yet — the install flow covers that
  }
}
globalThis.__aidModelOutdated = modelOutdated; // e2e hook

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "aid-check-image",
      title: "Sieve: check this image",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: "aid-report",
      title: "Sieve: report misclassification…",
      contexts: ["image"],
    });
  });
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/setup.html") });
  } else if (details.reason === "update" && (await modelOutdated())) {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/setup.html?update=1") });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "aid-check-image" && tab?.id && info.srcUrl) {
    chrome.tabs.sendMessage(tab.id, { kind: "aid:check-image", srcUrl: info.srcUrl });
  }
  if (info.menuItemId === "aid-report" && info.srcUrl) {
    // Privacy by construction: reporting opens a public GitHub issue form the
    // user can read and edit BEFORE submitting. The extension itself sends
    // nothing anywhere.
    const cached = cacheLookup(info.srcUrl);
    // GitHub issue forms only prefill input/textarea fields (not dropdowns),
    // and want %20 rather than "+" for spaces — encode manually.
    const band = !cached ? "not analyzed"
      : cached.score >= 0.65 ? "flagged as AI"
      : cached.score >= 0.5 ? "unsure"
      : "low score";
    const fields = {
      template: "misclassification.yml",
      title: "[misclassification] ",
      "image-url": info.srcUrl,
      "sieve-verdict": cached
        ? `${band} — score ${(cached.score * 100).toFixed(1)}%${cached.tta ? " (TTA)" : ""}`
        : "not analyzed",
      "model-version": chrome.runtime.getManifest().version,
    };
    const q = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    chrome.tabs.create({
      url: `https://github.com/Phineas1500/sieve-ai-image-detector/issues/new?${q}`,
    });
  }
});
