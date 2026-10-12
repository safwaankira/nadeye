// "My scanner" tab: sign in with a passkey (Mera), get an identity key and a
// scanner key, hand the scanner key to the extension, and create the ERC-8004
// agent identity your reputation accrues to. Bundled to web/passkey.js.
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { bytesToHex, formatEther, hexToBytes, parseEther } from "viem";
import { monad, monadTestnet } from "viem/chains";
import { deriveEvmKey, recoveryPhrase, createProfileClient, IDENTITY_INDEX, SCANNER_INDEX } from "./profile-core.js";
import { readAssertion, candidateKeys, pickKey, toWebAuthnAuth, keyToArgs, b64urlToBytes, passkeyRegistryAbi } from "./webauthn-proof.js";
import { JOURNAL_SALT, journalKeys, makeEntry, seal, readJournal, journalAbi } from "./journal.js";

const ERC8004 = {
  mainnet: { chain: monad, identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" },
  testnet: { chain: monadTestnet, identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e", reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" },
};
const CRED_KEY = "nadeye.passkey";
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const { CONFIG, NET } = window.NADEYE;
const net = ERC8004[CONFIG.network];
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "") && !/^0x0{40}$/.test(a);
const configured = isAddr(CONFIG.contract);
const passkeys = configured && isAddr(CONFIG.passkeys) ? CONFIG.passkeys : null;
const journal = configured && isAddr(CONFIG.journal) ? CONFIG.journal : null;

let prf = null;      // passkey PRF output (account namespace), memory only
let addrs = null;    // { identity, scanner }
let jkeys = null;    // { id, key } from the journal PRF namespace, memory only
let jentries = [];   // decrypted entries, memory only

// Signing scope: the passkey-derived keys sign without a prompt, so every transaction must go
// to Nadeye's own contracts, the ERC-8004 Identity Registry, or (to top up gas) your own scanner key.
const scope = () => new Set([CONFIG.contract, passkeys, journal, net.identity, addrs?.scanner].filter(Boolean).map((a) => a.toLowerCase()));
const client = configured ? createProfileClient({ chain: net.chain, rpcUrl: NET.rpc, contract: CONFIG.contract, identity: net.identity, reputation: net.reputation, allow: (to) => scope().has(String(to).toLowerCase()) }) : null;

// Session: keys exist only in this tab's memory and are wiped after IDLE_MS without input,
// at most MAX_MS after sign-in, or on "Lock now". Nothing secret is ever written to storage.
const IDLE_MS = 10 * 60_000, MAX_MS = 60 * 60_000;
let session = null; // { started, lastActive }
function startSession() { session = { started: Date.now(), lastActive: Date.now() }; }
function lock(reason) {
  if (prf) prf.fill(0);
  prf = null; addrs = null; last = null; jkeys = null; jentries = []; session = null;
  $("ppPhrase").hidden = true; $("ppPhrase").textContent = "";
  render();
  if (reason) toast(reason);
}
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => { if (session) session.lastActive = Date.now(); }, { passive: true });
setInterval(() => {
  if (!session) return;
  const now = Date.now();
  if (now - session.lastActive > IDLE_MS) lock("Locked after 10 minutes without activity. Sign in again with your passkey.");
  else if (now - session.started > MAX_MS) lock("Locked: sessions last at most an hour. Sign in again with your passkey.");
  else renderSession();
}, 15_000);

// Keys live only inside Mera signing sessions, ended (zeroed) after each action.
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

// The scanner key pays gas for its own transactions; top it up from the identity key when low.
const SCANNER_MIN = parseEther("0.02"), SCANNER_TOPUP = "0.05";
async function ensureScannerGas(identity, scanner) {
  const st = await client.status(identity.address, scanner.address);
  if (st.scannerBalance >= SCANNER_MIN) return;
  setBusy("Sending your scanner key a little MON for gas…");
  await client.fundScanner(identity, scanner.address, SCANNER_TOPUP);
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
    startSession();
    setBusy(null);
    if (create) await drip();
    await refresh();
  } catch (e) {
    setBusy(null, explain(e));
  }
}

async function sendToExtension() {
  setBusy("Confirm in the dialog the extension shows…");
  const key = bytesToHex(deriveEvmKey(prf, SCANNER_INDEX));
  const r = await askExtension({ type: "import-scanner-key", key, address: addrs.scanner });
  setBusy(null, r.ok ? null : `Extension: ${r.error}`);
  if (r.ok) toast(`Extension now scans as ${short(r.address)}`);
  await refresh();
}

async function setupAgent() {
  const handle = $("ppHandle").value.trim();
  try {
    await withAccounts(async (identity, scanner) => {
      await ensureScannerGas(identity, scanner);
      await client.setupAgent({ identityAccount: identity, scannerAccount: scanner, handle, onStep: (s) => setBusy(s + "…") });
    });
    setBusy(null);
    toast("Your ERC-8004 agent is live and linked");
  } catch (e) {
    setBusy(null, explain(e));
  }
  await refresh();
}

// One WebAuthn assertion with this site's passkey over `challenge` (raw bytes).
async function assertWith(challenge) {
  const known = readCred();
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge, rpId: location.hostname, userVerification: "required", timeout: 60_000,
      allowCredentials: known?.credentialId ? [{ type: "public-key", id: b64urlToBytes(known.credentialId), transports: known.transports }] : undefined,
    },
  });
  return readAssertion(cred);
}

// Prove onchain that this scanner is backed by the passkey: tap 1 narrows the passkey's
// P256 public key to two candidates, tap 2 signs the registry's challenge and picks the
// candidate that verifies; the scanner key then sends PasskeyRegistry.register.
async function provePasskey() {
  try {
    setBusy("Passkey prompt 1 of 2: reading your passkey's public key…");
    const candidates = candidateKeys(await assertWith(crypto.getRandomValues(new Uint8Array(32))));
    const challenge = await client.pub.readContract({ address: passkeys, abi: passkeyRegistryAbi, functionName: "registrationChallenge", args: [addrs.scanner] });
    setBusy("Passkey prompt 2 of 2: signing the proof…");
    const proof = await assertWith(hexToBytes(challenge));
    const key = pickKey(candidates, proof);
    if (!key) throw new Error("This passkey doesn't use a P256 key, so Monad's P256 precompile can't check it. Create a new passkey on this device and try again.");
    await withAccounts(async (identity, scanner) => {
      await ensureScannerGas(identity, scanner);
      setBusy("Recording the proof onchain…");
      await client.send(scanner, passkeys, passkeyRegistryAbi, "register", [...keyToArgs(key), toWebAuthnAuth(proof)]);
    });
    setBusy(null);
    toast("Passkey proof recorded onchain");
  } catch (e) {
    setBusy(null, /KeyInUse/.test(String(e?.message || e)) ? "This passkey already backs another scanner. Each passkey can prove one scanner." : explain(e));
  }
  await refresh();
}

// New accounts on testnet: ask the operator's faucet (CONFIG.drip) for a little MON so the
// first actions work without a detour. If it isn't set or says no, point to the public faucet.
async function drip() {
  if (CONFIG.network !== "testnet") return;
  const fallback = "Your identity address needs a little testnet MON. Get some at faucet.monad.xyz, then come back.";
  if (!/^https:\/\//.test(CONFIG.drip || "")) { toast(fallback); return; }
  setBusy("Getting you a little testnet MON for gas…");
  try {
    const r = await fetch(CONFIG.drip, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addrs.identity }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    toast(r.ok ? `Sent ${String(j.amount || "some").replace(/ MON$/, "")} testnet MON to your identity address for gas` : `${j.error || "The faucet said no"}. ${fallback}`);
  } catch {
    setBusy(null);
    toast(fallback);
  }
}

// ---- private journal -------------------------------------------------------------------
// A second PRF evaluation under the journal salt gives an encryption key and an opaque
// journal id, unrelated to the account keys. Entries are sealed here and stored on Monad
// as ciphertext; the same passkey on any device reads them back.
async function unlockJournal() {
  setBusy("Passkey prompt: unlocking your journal…");
  try {
    const known = readCred();
    const got = await getPasskeyPrfOutput({ rpId: location.hostname, credential: known || undefined, prfSalt: JOURNAL_SALT });
    jkeys = await journalKeys(got.prfOutput);
    got.prfOutput.fill?.(0);
    setBusy("Reading your journal from Monad…");
    jentries = await readJournal(client.pub, journal, jkeys);
    setBusy(null);
  } catch (e) {
    jkeys = null;
    setBusy(null, explain(e));
  }
  render();
}

async function saveToJournal(result, note) {
  if (!jkeys) await unlockJournal();
  if (!jkeys) return false;
  try {
    const entry = makeEntry({ pHash: result.hex, verdict: result.verdict, reports: result.reports, aiVotes: result.aiVotes, note });
    const box = await seal(jkeys, entry);
    await withAccounts(async (identity, scanner) => {
      await ensureScannerGas(identity, scanner);
      setBusy("Saving the encrypted entry to Monad…");
      await client.send(scanner, journal, journalAbi, "append", [jkeys.id, box]);
    });
    jentries.unshift(entry);
    setBusy(null);
    toast("Saved to your private journal");
    render();
    return true;
  } catch (e) {
    setBusy(null, /NotWriter/.test(String(e?.message || e)) ? "This journal belongs to a different scanner key." : explain(e));
    return false;
  }
}

// The registry view announces each checked image; offer to save it when the journal can.
document.addEventListener("nadeye:result", (ev) => {
  const r = ev.detail, slot = document.getElementById("journalSlot");
  if (!slot || !journal || !r?.hex) return;
  slot.replaceChildren();
  if (!addrs) {
    const p = document.createElement("p");
    p.className = "small"; p.style.margin = "0";
    p.textContent = "Sign in on My scanner to keep this in your private journal.";
    slot.append(p);
    return;
  }
  const row = document.createElement("div");
  row.className = "row-actions";
  const note = document.createElement("input");
  note.placeholder = "Note for your journal (only you can read it)";
  note.setAttribute("aria-label", "Journal note");
  note.maxLength = 280;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn"; btn.textContent = jkeys ? "Save to my journal" : "Unlock and save to my journal";
  btn.addEventListener("click", async () => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    btn.setAttribute("aria-disabled", "true");
    const ok = await saveToJournal(r, note.value);
    btn.removeAttribute("aria-disabled");
    const s = document.createElement("span"); s.className = "small"; s.setAttribute("role", "status");
    s.textContent = ok ? "Saved. It's in your journal on My scanner." : $("ppError").textContent || "Not saved.";
    if (ok) row.replaceChildren(s); else row.append(s);
  });
  row.append(note, btn);
  slot.append(row);
});

async function saveHandle() {
  const h = $("ppHandle").value.trim();
  if (!h) return;
  setBusy("Saving handle…");
  try { await withAccounts((_, sc) => client.setHandle(sc, h)); setBusy(null); toast("Handle saved"); }
  catch (e) { setBusy(null, explain(e)); }
  await refresh();
}

let last = null, extScanner = null;
async function refresh() {
  if (!addrs) return render();
  try { last = client ? await client.status(addrs.identity, addrs.scanner) : null; } catch (e) { last = { error: explain(e) }; }
  try {
    if (last && passkeys) {
      const [registered, , , at] = await client.pub.readContract({ address: passkeys, abi: passkeyRegistryAbi, functionName: "passkeyOf", args: [addrs.scanner] });
      last.passkey = { registered, at: Number(at) };
    }
  } catch { /* the status line says "–" */ }
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
    const off = !!msg || (b.dataset.needs === "contract" && !configured) || (b.dataset.needs === "passkeys" && !passkeys);
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
  const pk = last?.passkey;
  $("ppPkStatus").textContent = !passkeys ? "No PasskeyRegistry is configured for this page"
    : pk?.registered ? `Proved onchain on ${new Date(pk.at * 1000).toLocaleDateString()}` : pk ? "Not proved yet" : "–";
  $("ppProve").textContent = pk?.registered ? "Prove again" : "Prove with passkey";
  if (last?.error) setBusy(null, last.error);
  renderJournal();
  renderSession();
}

function renderSession() {
  if (!session) return;
  const until = new Date(Math.min(session.started + MAX_MS, session.lastActive + IDLE_MS));
  $("ppSession").textContent = `Keys are in this tab's memory only. They can sign for Nadeye's contracts and your scanner key, nothing else, and are wiped at ${until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} unless you keep using the page (an hour at most).`;
}

const VERDICT_TEXT = { ai: "Likely AI", real: "Likely real", split: "Split", none: "Not in the registry" };
function renderJournal() {
  $("ppJournalPanel").hidden = !journal;
  if (!journal) return;
  $("ppJUnlock").hidden = !!jkeys;
  $("ppJLock").hidden = !jkeys;
  $("ppJStatus").textContent = jkeys ? `Unlocked · ${jentries.length} ${jentries.length === 1 ? "entry" : "entries"}` : "Locked";
  const list = $("ppJList");
  list.replaceChildren();
  list.hidden = !jkeys;
  if (!jkeys) return;
  if (!jentries.length) {
    const li = document.createElement("li"); li.className = "small";
    li.textContent = "Nothing saved yet. Check an image on the Registry tab, then save it here.";
    list.append(li);
  }
  for (const e of jentries) {
    const li = document.createElement("li");
    const head = document.createElement("div");
    const b = document.createElement("b"); b.textContent = VERDICT_TEXT[e.d] || String(e.d);
    const meta = document.createElement("span"); meta.className = "small";
    meta.textContent = ` · ${e.r ? `${e.a}/${e.r} AI` : "no reports"} · pHash ${e.p} · ${new Date(e.t * 1000).toLocaleString()}`;
    head.append(b, meta);
    li.append(head);
    if (e.n) { const n = document.createElement("div"); n.className = "small"; n.textContent = e.n; li.append(n); }
    list.append(li);
  }
}

$("ppCreate").addEventListener("click", () => signIn(true));
$("ppLogin").addEventListener("click", () => signIn(false));
$("ppSend").addEventListener("click", sendToExtension);
$("ppSetup").addEventListener("click", setupAgent);
$("ppSaveHandle").addEventListener("click", saveHandle);
$("ppProve").addEventListener("click", provePasskey);
$("ppSignOut").addEventListener("click", () => lock("Locked. Your keys were wiped from this tab."));
$("ppJUnlock").addEventListener("click", unlockJournal);
$("ppJLock").addEventListener("click", () => { jkeys = null; jentries = []; render(); });
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
