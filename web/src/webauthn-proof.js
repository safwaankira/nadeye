// WebAuthn assertion -> PasskeyRegistry.WebAuthnAuth, plus recovery of the passkey's P256
// public key from signatures (WebAuthn only hands out the public key when the passkey is
// created; this works for any existing passkey, on any device). No DOM here, so Node tests
// exercise the same code the site runs.
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, numberToHex } from "viem";

const N = p256.Point.Fn.ORDER;
const enc = new TextEncoder();
const bytes32 = (n) => numberToHex(n, { size: 32 });

export const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

/** the fields of a PublicKeyCredential assertion we need, as bytes and text */
export function readAssertion(credential) {
  const r = credential.response;
  return {
    authenticatorData: new Uint8Array(r.authenticatorData),
    clientDataJSON: new TextDecoder().decode(r.clientDataJSON),
    signature: new Uint8Array(r.signature), // ASN.1 DER
  };
}

/** sha256(authenticatorData || sha256(clientDataJSON)): what the passkey signed */
export function signedHash({ authenticatorData, clientDataJSON }) {
  const cd = sha256(enc.encode(clientDataJSON));
  const buf = new Uint8Array(authenticatorData.length + 32);
  buf.set(authenticatorData);
  buf.set(cd, authenticatorData.length);
  return sha256(buf);
}

/** r, s from DER, with s moved to the lower half (the contract rejects malleable high-s) */
export function rs(signatureDer) {
  const sig = p256.Signature.fromBytes(signatureDer, "der");
  const s = sig.s > N / 2n ? N - sig.s : sig.s;
  return { r: sig.r, s };
}

/** both public keys that could have produced this assertion's signature */
export function candidateKeys(assertion) {
  const h = signedHash(assertion);
  const sig = p256.Signature.fromBytes(assertion.signature, "der");
  const out = [];
  for (const bit of [0, 1]) {
    try {
      const P = sig.addRecoveryBit(bit).recoverPublicKey(h).toAffine();
      out.push({ x: P.x, y: P.y });
    } catch { /* this recovery bit has no valid point */ }
  }
  return out;
}

/** the candidate that also verifies a second, independent assertion */
export function pickKey(candidates, assertion) {
  const h = signedHash(assertion);
  const { r, s } = rs(assertion.signature);
  const sig = new p256.Signature(r, s);
  return candidates.find((k) => p256.verify(sig.toBytes("compact"), h, p256.Point.fromAffine(k).toBytes(false), { prehash: false, lowS: false })) || null;
}

/** the struct PasskeyRegistry.verify takes */
export function toWebAuthnAuth(assertion) {
  const { r, s } = rs(assertion.signature);
  const typeIndex = assertion.clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = assertion.clientDataJSON.indexOf('"challenge":"');
  if (typeIndex < 0 || challengeIndex < 0) throw new Error("not a WebAuthn authentication response");
  return {
    authenticatorData: bytesToHex(assertion.authenticatorData),
    clientDataJSON: assertion.clientDataJSON,
    challengeIndex: BigInt(challengeIndex),
    typeIndex: BigInt(typeIndex),
    r: bytes32(r),
    s: bytes32(s),
  };
}

export const keyToArgs = (k) => [bytes32(k.x), bytes32(k.y)];

export const passkeyRegistryAbi = [
  { type: "function", name: "registrationChallenge", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "passkeyOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "registered", type: "bool" }, { name: "x", type: "bytes32" }, { name: "y", type: "bytes32" }, { name: "registeredAt", type: "uint64" }] },
  { type: "function", name: "hasPasskeys", stateMutability: "view", inputs: [{ name: "accounts", type: "address[]" }], outputs: [{ type: "bool[]" }] },
  {
    type: "function", name: "register", stateMutability: "nonpayable",
    inputs: [
      { name: "x", type: "bytes32" }, { name: "y", type: "bytes32" },
      { name: "auth", type: "tuple", components: [
        { name: "authenticatorData", type: "bytes" }, { name: "clientDataJSON", type: "string" },
        { name: "challengeIndex", type: "uint256" }, { name: "typeIndex", type: "uint256" },
        { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
      ] },
    ],
    outputs: [],
  },
  // errors, so viem decodes reverts by name (the page matches on KeyInUse for its message)
  { type: "error", name: "InvalidPublicKey", inputs: [] },
  { type: "error", name: "KeyInUse", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "BadAssertion", inputs: [] },
];
