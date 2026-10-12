// "My scanner" tab: sign in with a passkey (Mera), get an identity key and a
// scanner key, hand the scanner key to the extension, and create the ERC-8004
// agent identity your reputation accrues to. Bundled to web/passkey.js.
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { formatEther } from "viem";
import { monad, monadTestnet } from "viem/chains";
import { deriveEvmKey, recoveryPhrase, keyHex, createProfileClient, IDENTITY_INDEX, SCANNER_INDEX } from "./profile-core.js";

const ERC8004 = {
  mainnet: { chain: monad, identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" },
  testnet: { chain: monadTestnet, identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e", reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" },
};
const CRED_KEY = "nadeye.passkey";
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const { CONFIG, NET } = window.NADEYE;
const net = ERC8004[CONFIG.network];
const configured = /^0x[0-9a-fA-F]{40}$/.test(CONFIG.contract) && !/^0x0{40}$/.test(CONFIG.contract);
const client = configured ? createProfileClient({ chain: net.chain, rpcUrl: NET.rpc, contract: CONFIG.contract, identity: net.identity, reputation: net.reputation }) : null;

let prf = null;      // passkey PRF output, memory only
let addrs = null;    // { identity, scanner }

// ----------------------------------------------------------- key handling
// Keys are derived on demand and wrapped in Mera signing sessions that are
// ended (zeroed) right after each action.
async function withAccounts(fn) {
  const idSession = createSecp256k1SigningSession({ privateKey: deriveEvmKey(prf, IDENTITY_INDEX) });
  const scSession = createSecp256k1SigningSession({ privateKey: deriveEvmKey(prf, SCANNER_INDEX) });
  try {
    return await fn(toViemAccount(idSession), toViemAccount(scSession));
  } finally {
    idSession.end();
    scSession.end();
  }
}

function readCred() { try { return JSON.parse(localStorage.getItem(CRED_KEY) || "null"); } catch { return null; } }
function writeCred(c) { try { localStorage.setItem(CRED_KEY, JSON.stringify(c)); } catch {} }

function explain(e) {
  if (isMeraError?.(e)) {
    if (e.code === "PRF_UNAVAILABLE") return "This passkey provider can't derive keys (no PRF support). In Chrome, save the passkey to Google Password Manager; in Safari, use iCloud Keychain.";
    if (e.code === "PASSKEY_OPERATION_FAILED") return "The passkey prompt was dismissed or failed. Try again, or open the hosted site if you're in a preview.";
    if (e.code === "CRYPTO_UNAVAILABLE") return "This browser can't do the key derivation (WebCrypto unavailable). Use a current Chrome or Safari over https.";
  }
  const msg = String(e?.shortMessage || e?.message || e);
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(msg)) return "Not enough MON for gas. Send a little MON to your identity address, then try again.";
  if (/Permissions Policy|publickey-credentials|not allowed in this document|NotAllowedError/i.test(msg)) return "Passkeys can't run in this preview frame. Open the hosted Nadeye site to sign in.";
  return msg;
}

// ------------------------------------------------------- extension bridge
let extReady = !!document.documentElement.dataset.nadeyeExtension;
const pending = new Map();
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.origin !== location.origin || ev.data?.source !== "nadeye-extension") return;
  if (ev.data.type === "ready") { extReady = true; render(); return; }
  const p = pending.get(ev.data.id);
  if (p) { pending.delete(ev.data.id); p(ev.data); }
});
function askExtension(msg, timeout = 60_000) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    pending.set(id, resolve);
    window.postMessage({ source: "nadeye-site", id, ...msg }, location.origin);
    setTimeout(() => { if (pending.delete(id)) resolve({ ok: false, error: "the extension did not answer" }); }, timeout);
  });
}

// --------------------------------------------------------------- actions
async function signIn(create) {
  setBusy(create ? "Creating your passkey…" : "Waiting for your passkey…");
  try {
    if (create) {
      const name = ($("ppName").value || "Nadeye scanner").slice(0, 64);
      const created = await createPasskeyWithPrfOutput({ rp: { id: location.hostname, name: "Nadeye" }, user: { name, displayName: name } });
      writeCred({ credentialId: created.credentialId, transports: created.transports });
      prf = created.prfOutput;
    } else {
      const known = readCred();
      const got = await getPasskeyPrfOutput({ rpId: location.hostname, credential: known || undefined });
      if (known?.credentialId !== got.credentialId) writeCred({ credentialId: got.credentialId });
      prf = got.prfOutput;
    }
    await withAccounts(async (id, sc) => { addrs = { identity: id.address, scanner: sc.address }; });
    setBusy(null);
    await refresh();
  } catch (e) {
    setBusy(null, explain(e));
  }
}

async function sendToExtension() {
  setBusy("Confirm in the dialog the extension shows…");
  const key = keyHex(deriveEvmKey(prf, SCANNER_INDEX));
  const r = await askExtension({ type: "import-scanner-key", key, address: addrs.scanner });
  setBusy(null, r.ok ? null : `Extension: ${r.error}`);
  if (r.ok) toast(`Extension now scans as ${short(r.address)}`);
  await refresh();
}

async function setupAgent() {
  const handle = $("ppHandle").value.trim();
  try {
    await withAccounts(async (identity, scanner) => {
      const st = await client.status(identity.address, scanner.address);
      if (st.scannerBalance < 20_000_000_000_000_000n) { // < 0.02 MON
        setBusy("Sending your scanner key a little MON for gas…");
        await client.fundScanner(identity, scanner.address, "0.05");
      }
      await client.setupAgent({ identityAccount: identity, scannerAccount: scanner, handle, onStep: (s) => setBusy(s + "…") });
    });
    setBusy(null);
    toast("Your ERC-8004 agent is live and linked");
  } catch (e) {
    setBusy(null, explain(e));
  }
  await refresh();
}

async function saveHandle() {
  const h = $("ppHandle").value.trim();
  if (!h) return;
  setBusy("Saving handle…");
  try { await withAccounts((_, sc) => client.setHandle(sc, h)); setBusy(null); toast("Handle saved"); }
  catch (e) { setBusy(null, explain(e)); }
  await refresh();
}

// --------------------------------------------------------------- render
let last = null, extScanner = null;
async function refresh() {
  if (!addrs) return render();
  try { last = client ? await client.status(addrs.identity, addrs.scanner) : null; } catch (e) { last = { error: explain(e) }; }
  if (extReady) {
    const r = await askExtension({ type: "get-scanner" }, 4000);
    extScanner = r.ok ? r.address : null;
  }
  render();
}

// Buttons stay focusable while a transaction runs (aria-disabled, not
// disabled), so focus is never dropped and the progress text is announced
// through the polite #ppBusy region.
function setBusy(msg, error = null) {
  $("ppBusy").textContent = msg || "";
  $("ppError").textContent = error || "";
  document.querySelectorAll("#view-me button").forEach((b) => {
    if (b.id === "ppToastClose") return;
    const off = !!msg || (b.dataset.needs === "contract" && !configured);
    if (off) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
  });
}
// Persistent banner: stays until dismissed or replaced (no auto-hiding toasts)
function toast(t) { $("ppToastText").textContent = t; }
$("ppToastClose").addEventListener("click", () => { $("ppToastText").textContent = ""; });
// swallow activation of aria-disabled buttons (capture phase, before their handlers)
$("view-me").addEventListener("click", (e) => {
  const b = e.target.closest("button[aria-disabled='true']");
  if (b) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

function render() {
  $("ppSignedOut").hidden = !!addrs;
  $("ppSignedIn").hidden = !addrs;
  $("ppNoContract").hidden = configured;
  $("ppExt").textContent = extReady ? "Extension detected" : "Extension not detected on this site (add this site under Options → Trusted Nadeye sites)";
  if (!addrs) return;
  const link = (a) => `<a href="${NET.explorer}/address/${a}" target="_blank" rel="noopener">${short(a)}</a>`;
  $("ppIdAddr").innerHTML = link(addrs.identity);
  $("ppScAddr").innerHTML = link(addrs.scanner);
  $("ppIdBal").textContent = last?.identityBalance != null ? `${Number(formatEther(last.identityBalance)).toFixed(4)} MON` : "–";
  $("ppScBal").textContent = last?.scannerBalance != null ? `${Number(formatEther(last.scannerBalance)).toFixed(4)} MON` : "–";
  const sc = last?.scanner;
  $("ppAgent").textContent = sc?.hasAgent ? `#${sc.agentId}` : "not created yet";
  $("ppRep").textContent = last?.reputation?.count ? `${last.reputation.agreement.toFixed(1)}% agreement over ${last.reputation.count} judged verdicts` : sc?.hasAgent ? "no judged verdicts yet" : "–";
  $("ppPoints").textContent = sc ? `${Number(sc.points).toLocaleString()} points · ${sc.scans} scans` : "–";
  if (sc?.handle && document.activeElement !== $("ppHandle")) $("ppHandle").value = `@${sc.handle}`;
  const inExt = extScanner && extScanner.toLowerCase() === addrs.scanner.toLowerCase();
  $("ppInExt").textContent = inExt ? "✓ the extension is using this scanner key" : extScanner ? `extension currently uses ${short(extScanner)}` : "";
  $("ppSend").hidden = !extReady || inExt;
  $("ppSetup").hidden = !!sc?.hasAgent;
  if (last?.error) setBusy(null, last.error);
}

$("ppCreate").addEventListener("click", () => signIn(true));
$("ppLogin").addEventListener("click", () => signIn(false));
$("ppSend").addEventListener("click", sendToExtension);
$("ppSetup").addEventListener("click", setupAgent);
$("ppSaveHandle").addEventListener("click", saveHandle);
$("ppSignOut").addEventListener("click", () => { prf = null; addrs = null; last = null; $("ppPhrase").hidden = true; render(); });
$("ppReveal").addEventListener("click", () => {
  const box = $("ppPhrase");
  if (!box.hidden) { box.hidden = true; box.textContent = ""; return; }
  box.textContent = recoveryPhrase(prf);
  box.hidden = false;
});
$("ppCopyId").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(addrs.identity); toast("Identity address copied"); } catch { toast(addrs.identity); }
});
setBusy(null);
render();
if (readCred()) $("ppLogin").classList.add("primary");
