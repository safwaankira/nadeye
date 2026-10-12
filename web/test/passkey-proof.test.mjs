// Onchain passkey proof, end to end: a simulated platform authenticator (P256, browser-shaped
// clientDataJSON and authenticatorData, sometimes high-s like real devices) -> public key
// recovered from two assertions -> PasskeyRegistry.register on anvil, verified by the native
// P256 precompile (anvil --hardfork osaka puts it at 0x100, the address Monad uses).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, hexToBytes as viemHexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { candidateKeys, pickKey, toWebAuthnAuth, keyToArgs, signedHash, rs, passkeyRegistryAbi } from "../src/webauthn-proof.js";

const OUT = new URL("../../contracts/out/", import.meta.url);
const skip = spawnSync("anvil", ["--version"]).status !== 0 || !existsSync(new URL("PasskeyRegistry.sol", OUT)) ? "anvil or compiled contracts missing" : false;
const N = p256.Point.Fn.ORDER;
const b64url = (u8) => Buffer.from(u8).toString("base64url");

/** what a browser hands back from navigator.credentials.get, for a given challenge */
function authenticator(sk, rpId = "nadeye.example") {
  let counter = 0;
  return (challenge, { forceHighS = false } = {}) => {
    const clientDataJSON = JSON.stringify({ type: "webauthn.get", challenge: b64url(challenge), origin: `https://${rpId}`, crossOrigin: false });
    const authenticatorData = new Uint8Array([...sha256(new TextEncoder().encode(rpId)), 0x05, 0, 0, 0, ++counter]);
    const h = signedHash({ authenticatorData, clientDataJSON });
    let sig = p256.Signature.fromBytes(p256.sign(h, sk, { prehash: false, lowS: false, format: "compact" }), "compact");
    const isHigh = sig.s > N / 2n;
    if (forceHighS !== isHigh) sig = new p256.Signature(sig.r, N - sig.s); // flip to the requested half
    return { authenticatorData, clientDataJSON, signature: sig.toBytes("der") };
  };
}

test("recovers the right P256 key from two assertions and normalises high-s", () => {
  const sk = p256.utils.randomSecretKey();
  const pub = p256.Point.fromBytes(p256.getPublicKey(sk, false)).toAffine();
  const sign = authenticator(sk);
  const a1 = sign(crypto.getRandomValues(new Uint8Array(32)));
  const cands = candidateKeys(a1);
  assert.ok(cands.length >= 1 && cands.length <= 2);
  assert.ok(cands.some((k) => k.x === pub.x && k.y === pub.y), "true key is a candidate");
  const a2 = sign(crypto.getRandomValues(new Uint8Array(32)), { forceHighS: true });
  const k = pickKey(cands, a2);
  assert.deepEqual(k, { x: pub.x, y: pub.y });
  assert.ok(rs(a2.signature).s <= N / 2n, "s normalised");
  const auth = toWebAuthnAuth(a2);
  assert.equal(a2.clientDataJSON.slice(Number(auth.typeIndex)).startsWith('"type":"webauthn.get"'), true);
  assert.equal(a2.clientDataJSON.slice(Number(auth.challengeIndex)).startsWith('"challenge":"'), true);
});

test("a passkey proof registers onchain through the P256 precompile", { skip, timeout: 120_000 }, async (t) => {
  const PORT = 8562, RPC = `http://127.0.0.1:${PORT}`;
  const anvil = spawn("anvil", ["--port", String(PORT), "--hardfork", "osaka", "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const deployer = createWalletClient({ account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"), chain: foundry, transport: http(RPC) });
  const art = JSON.parse(readFileSync(new URL("PasskeyRegistry.sol/PasskeyRegistry.json", OUT)));
  const registry = (await pub.waitForTransactionReceipt({ hash: await deployer.deployContract({ abi: art.abi, bytecode: art.bytecode.object }) })).contractAddress;

  // the scanner key (in the site, the Mera-derived key) sends the transaction
  const scanner = createWalletClient({ account: privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"), chain: foundry, transport: http(RPC) });
  const sign = authenticator(p256.utils.randomSecretKey());

  const cands = candidateKeys(sign(crypto.getRandomValues(new Uint8Array(32)))); // tap 1
  const challenge = await pub.readContract({ address: registry, abi: passkeyRegistryAbi, functionName: "registrationChallenge", args: [scanner.account.address] });
  const a2 = sign(viemHexToBytes(challenge), { forceHighS: true }); // tap 2, over the onchain challenge
  const key = pickKey(cands, a2);
  assert.ok(key);
  const hash = await scanner.writeContract({ address: registry, abi: passkeyRegistryAbi, functionName: "register", args: [...keyToArgs(key), toWebAuthnAuth(a2)] });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rcpt.status, "success");
  const [has] = await pub.readContract({ address: registry, abi: passkeyRegistryAbi, functionName: "hasPasskeys", args: [[scanner.account.address]] });
  assert.equal(has, true);
  // the same proof cannot be replayed: the challenge nonce moved on
  await assert.rejects(scanner.writeContract({ address: registry, abi: passkeyRegistryAbi, functionName: "register", args: [...keyToArgs(key), toWebAuthnAuth(a2)] }), /BadAssertion/);
  // one passkey backs one scanner: another account (funded, so the contract decides) is refused by name
  const other = createWalletClient({ account: privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"), chain: foundry, transport: http(RPC) });
  const c2 = await pub.readContract({ address: registry, abi: passkeyRegistryAbi, functionName: "registrationChallenge", args: [other.account.address] });
  await assert.rejects(other.writeContract({ address: registry, abi: passkeyRegistryAbi, functionName: "register", args: [...keyToArgs(key), toWebAuthnAuth(sign(viemHexToBytes(c2)))] }), /KeyInUse/);
  console.log(`register gas with the native P256 precompile: ${rcpt.gasUsed}`);
});
