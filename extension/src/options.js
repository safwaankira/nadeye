const $ = (id) => document.getElementById(id);
const defaults = { enabled: true, threshold: 0.65, blur: true, minSize: 96, minDisplaySize: 100,
  scanMode: "auto", flaggedAction: "blur", badgeDisplay: "all" };

chrome.storage.sync.get(defaults, (s) => {
  $("enabled").checked = s.enabled;
  const action = ["badge", "blur", "hide"].includes(s.flaggedAction)
    ? s.flaggedAction
    : s.blur ? "blur" : "badge";
  $("scanMode").value = s.scanMode;
  $("flaggedAction").value = action;
  $("badgeDisplay").value = s.badgeDisplay;
  $("threshold").value = s.threshold;
  $("thval").textContent = `${Math.round(s.threshold * 100)}%`;
  $("minSize").value = s.minSize;
  $("minDisplaySize").value = s.minDisplaySize;
});

$("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$("threshold").addEventListener("input", (e) => {
  $("thval").textContent = `${Math.round(e.target.value * 100)}%`;
  chrome.storage.sync.set({ threshold: Number(e.target.value) });
});
$("minSize").addEventListener("change", (e) => chrome.storage.sync.set({ minSize: Number(e.target.value) }));
$("minDisplaySize").addEventListener("change", (e) => chrome.storage.sync.set({ minDisplaySize: Number(e.target.value) }));
$("scanMode").addEventListener("change", (e) => chrome.storage.sync.set({ scanMode: e.target.value }));
$("flaggedAction").addEventListener("change", (e) => chrome.storage.sync.set({
  flaggedAction: e.target.value,
  blur: e.target.value === "blur",
}));
$("badgeDisplay").addEventListener("change", (e) => chrome.storage.sync.set({ badgeDisplay: e.target.value }));

// PixelProof: scanner wallet backup / restore
$("revealKey").addEventListener("click", async () => {
  if (!confirm("Anyone with this key controls your scanner wallet and points. Show it?")) return;
  const r = await chrome.runtime.sendMessage({ kind: "pp:export-key" });
  $("keyOut").textContent = r && r.ok ? r.key : r?.error || "unavailable";
});
$("doImport").addEventListener("click", async () => {
  const key = $("importKey").value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) { $("importMsg").textContent = "Expected 0x + 64 hex characters."; return; }
  if (!confirm("Replace the current scanner wallet? Back up its key first if it holds points.")) return;
  const r = await chrome.runtime.sendMessage({ kind: "pp:import-key", key });
  $("importMsg").textContent = r && r.ok ? `Now scanning as ${r.address}` : r?.error || "failed";
  $("importKey").value = "";
});

// PixelProof: per-network contract / RPC override
async function loadOverride() {
  const { ppCustom = {} } = await chrome.storage.local.get(["ppCustom"]);
  const o = ppCustom[$("ovNet").value] || {};
  $("ovContract").value = o.contract || "";
  $("ovRpc").value = o.rpcUrl || "";
}
$("ovNet").addEventListener("change", loadOverride);
$("ovSave").addEventListener("click", async () => {
  const contract = $("ovContract").value.trim(), rpcUrl = $("ovRpc").value.trim();
  if (contract && !/^0x[0-9a-fA-F]{40}$/.test(contract)) { $("ovMsg").textContent = "Contract must be 0x + 40 hex."; return; }
  if (rpcUrl && !/^https:\/\//.test(rpcUrl)) { $("ovMsg").textContent = "RPC must be https://"; return; }
  const { ppCustom = {} } = await chrome.storage.local.get(["ppCustom"]);
  ppCustom[$("ovNet").value] = { contract, rpcUrl };
  await chrome.storage.local.set({ ppCustom });
  $("ovMsg").textContent = "Saved.";
});
loadOverride();
