// Private scan journal: Mera PRF key material used for encryption, not for an account.
//
// The passkey evaluates its PRF under a salt of its own ("nadeye:journal:v1"), a namespace
// unrelated to the account keys (Mera's default salt). From that 32-byte output, HKDF makes
// two independent values: an AES-256-GCM key and an opaque journal id. Entries are sealed
// in the browser and stored as ciphertext on Monad (NadeyeJournal). The same passkey on any
// device re-derives both and decrypts the journal; nothing secret is stored anywhere.
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "viem";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** the PRF salt namespace for the journal (32 bytes, as WebAuthn PRF requires) */
export const JOURNAL_SALT = sha256(enc.encode("nadeye:journal:v1"));
export const MAX_ENTRY_BYTES = 512; // NadeyeJournal.MAX_ENTRY_BYTES
const VERSION = 1;

/** { id, key } from the journal-namespace PRF output; key is a non-extractable CryptoKey */
export async function journalKeys(prfOutput) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw new Error("journal PRF output must be 32 bytes");
  const raw = hkdf(sha256, prfOutput, undefined, enc.encode("nadeye journal aes-256-gcm v1"), 32);
  const id = bytesToHex(hkdf(sha256, prfOutput, undefined, enc.encode("nadeye journal id v1"), 32));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return { id, key };
}

/** a journal entry: what you checked, what the registry said, your note */
export function makeEntry({ pHash, verdict, reports = 0, aiVotes = 0, note = "", at = Math.floor(Date.now() / 1000) }) {
  if (!/^[0-9a-f]{16}$/.test(pHash)) throw new Error("pHash must be 16 lowercase hex characters");
  return { v: VERSION, p: pHash, d: verdict, r: reports, a: aiVotes, n: fitNote(note), t: at };
}

const NOTE_BYTES = 300; // leaves room for the other fields, the nonce and the tag within 512 bytes
/** cut a note by whole characters until its JSON form fits NOTE_BYTES, so emoji never split */
function fitNote(note) {
  const chars = Array.from(String(note));
  let n = Math.min(chars.length, 280);
  while (n > 0 && enc.encode(JSON.stringify(chars.slice(0, n).join(""))).length > NOTE_BYTES) n--;
  return chars.slice(0, n).join("");
}

/** version || 12-byte nonce || AES-GCM(JSON), with the journal id as associated data */
export async function seal({ id, key }, entry) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: hexToBytes(id) }, key, enc.encode(JSON.stringify(entry))));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = VERSION; out.set(nonce, 1); out.set(ct, 13);
  if (out.length > MAX_ENTRY_BYTES) throw new Error("This note is too long to store. Shorten it and try again.");
  return bytesToHex(out);
}

/** the entry, or null when the bytes are not a valid entry of this journal */
export async function open({ id, key }, sealedHex) {
  try {
    const b = hexToBytes(sealedHex);
    if (b.length < 1 + 12 + 16 || b[0] !== VERSION) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(1, 13), additionalData: hexToBytes(id) }, key, b.slice(13));
    const e = JSON.parse(dec.decode(pt));
    return e && e.v === VERSION && /^[0-9a-f]{16}$/.test(e.p) ? e : null;
  } catch {
    return null;
  }
}

export const journalAbi = [
  { type: "function", name: "append", stateMutability: "nonpayable", inputs: [{ name: "journalId", type: "bytes32" }, { name: "entry", type: "bytes" }], outputs: [] },
  { type: "function", name: "count", stateMutability: "view", inputs: [{ name: "journalId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "entries", stateMutability: "view", inputs: [{ name: "journalId", type: "bytes32" }, { name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }], outputs: [{ type: "bytes[]" }] },
  { type: "function", name: "writerOf", stateMutability: "view", inputs: [{ name: "journalId", type: "bytes32" }], outputs: [{ type: "address" }] },
];

/** read and decrypt a whole journal (newest first), skipping anything that fails to open */
export async function readJournal(pub, address, keys) {
  const n = Number(await pub.readContract({ address, abi: journalAbi, functionName: "count", args: [keys.id] }));
  const out = [];
  for (let off = 0; off < n; off += 50) {
    const page = await pub.readContract({ address, abi: journalAbi, functionName: "entries", args: [keys.id, BigInt(off), 50n] });
    for (const b of page) { const e = await open(keys, b); if (e) out.push(e); }
  }
  return out.reverse();
}
