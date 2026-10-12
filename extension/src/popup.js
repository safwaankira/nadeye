const $ = (id) => document.getElementById(id);

const defaults = { enabled: true, threshold: 0.65, blur: true, flaggedAction: "blur" };

chrome.storage.sync.get(defaults, (s) => {
  $("enabled").checked = s.enabled;
  $("blur").checked = s.flaggedAction === "blur" && s.blur !== false;
  $("threshold").value = s.threshold;
  $("thval").textContent = `${Math.round(s.threshold * 100)}%`;
});

$("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$("blur").addEventListener("change", (e) => chrome.storage.sync.set({
  blur: e.target.checked,
  flaggedAction: e.target.checked ? "blur" : "badge",
}));
$("threshold").addEventListener("input", (e) => {
  $("thval").textContent = `${Math.round(e.target.value * 100)}%`;
  e.target.setAttribute("aria-valuetext", `${Math.round(e.target.value * 100)}% — images at or above this AI confidence are flagged`);
  chrome.storage.sync.set({ threshold: Number(e.target.value) });
});

$("setup").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/setup.html") }));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.sendMessage({ kind: "aid:model-status" }, async (st) => {
  $("ep").textContent = st && st.ready
    ? (st.selftest || "").startsWith("fallback")
      ? "ready (wasm — gpu numerics fallback)"
      : `ready (${st.ep})`
    : "not set up";
  try {
    const manifest = await (await fetch(chrome.runtime.getURL("model_manifest.json"))).json();
    if (st && st.ready && manifest.version && st.version !== manifest.version) {
      $("ep").textContent = "model update available — open Model setup";
    }
  } catch {}
});

// Which weights are actually installed (OPFS meta) — the ground truth that
// separates "stale model" reports from real regressions.
(async () => {
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("model_meta.json");
    const meta = JSON.parse(await (await fh.getFile()).text());
    $("modelver").textContent = meta.version || "unknown";
  } catch {
    $("modelver").textContent = "none";
  }
})();

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { kind: "aid:page-stats" }, (r) => {
    if (chrome.runtime.lastError || !r) return;
    $("analyzed").textContent = r.analyzed;
    $("flagged").textContent = r.flagged;
  });
});

// ------------------------------------------------------------- Nadeye

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–");
let pp = null;

async function refreshPP() {
  const st = await chrome.runtime.sendMessage({ kind: "pp:status" });
  if (!st || !st.ok) {
    $("addr").textContent = st?.error || "unavailable";
    return;
  }
  pp = st;
  $("network").value = st.settings.ppNetwork;
  $("contribute").checked = !!st.settings.ppContribute;
  $("unconfigured").hidden = st.configured;
  $("addr").textContent = short(st.address);
  $("addr").title = `${st.address} — click to copy`;
  $("balance").textContent = st.balance != null ? `${Number(st.balance).toFixed(3)} MON` : "–";
  $("queued").textContent = st.queued;
  $("flush").disabled = !st.configured || st.queued === 0;
  $("nogas").hidden = !(st.configured && st.settings.ppContribute && Number(st.balance || 0) === 0);
  $("faucet").hidden = !st.faucet;
  const me = st.me;
  $("points").textContent = me ? me.points.toLocaleString() : "0";
  $("scans").textContent = me ? me.scans.toLocaleString() : "0";
  $("days").textContent = me ? me.activeDays : "0";
  $("snr").textContent = me && me.snr != null ? `${me.snr.toFixed(0)}%` : "–";
  $("agent").textContent = me && me.agentId != null
    ? `#${me.agentId}${me.reputation && me.reputation.count ? ` · ${me.reputation.agreement.toFixed(0)}% agree (${me.reputation.count})` : ""}`
    : "not linked — sign in on the site";
  if (me && me.handle && document.activeElement !== $("handle")) $("handle").value = `@${me.handle}`;
  $("lasttx").innerHTML = "";
  if (st.lastTx) {
    const a = document.createElement("a");
    a.href = `${st.explorer}/tx/${st.lastTx.hash}`;
    a.target = "_blank";
    a.textContent = `Last batch: ${st.lastTx.n} verdicts · ${new Date(st.lastTx.at).toLocaleTimeString()}`;
    $("lasttx").append(a);
  }
  $("savehandle").disabled = !st.configured;
}

$("network").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ ppNetwork: e.target.value });
  setTimeout(refreshPP, 100);
});
$("contribute").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ ppContribute: e.target.checked });
  setTimeout(refreshPP, 100);
});
$("addr").addEventListener("click", () => {
  if (!pp) return;
  navigator.clipboard.writeText(pp.address);
  $("addr").textContent = "copied!";
  setTimeout(() => ($("addr").textContent = short(pp.address)), 900);
});
$("flush").addEventListener("click", async () => {
  $("flush").disabled = true;
  $("flush").textContent = "…";
  const r = await chrome.runtime.sendMessage({ kind: "pp:flush" });
  $("flush").textContent = r && r.sent ? `✓ ${r.sent}` : r?.reason === "no-gas" ? "no gas" : "Send";
  setTimeout(() => { $("flush").textContent = "Send"; refreshPP(); }, 1500);
});
$("savehandle").addEventListener("click", async () => {
  const h = $("handle").value.trim().replace(/^@/, "");
  if (!h) return;
  $("savehandle").disabled = true;
  $("savehandle").textContent = "…";
  const r = await chrome.runtime.sendMessage({ kind: "pp:set-handle", handle: h });
  $("savehandle").textContent = r && r.ok ? "✓" : "retry";
  setTimeout(() => { $("savehandle").textContent = "Save"; refreshPP(); }, 1500);
});
const open = (url) => url && chrome.tabs.create({ url });
$("board").addEventListener("click", () => open(pp?.leaderboard));
$("faucet").addEventListener("click", () => open(pp?.faucet));
$("faucet2").addEventListener("click", () => open(pp?.faucet));

refreshPP();
