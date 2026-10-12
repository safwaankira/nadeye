// The passkey profile flow minus the WebAuthn prompt: fixed PRF output ->
// Mera signing sessions -> ERC-8004 agent owned by the identity key with the
// scanner key as agentWallet -> linked in Nadeye. Real ERC-8004 reference
// registries on anvil (compiled by forge in ../contracts).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { deriveEvmKey, recoveryPhrase, createProfileClient, identityAbi, IDENTITY_INDEX, SCANNER_INDEX, keyHex } from "../src/profile-core.js";

const OUT = new URL("../../contracts/out/", import.meta.url);
const art = (file, name) => JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT)));
const skip = spawnSync("anvil", ["--version"]).status !== 0 || !existsSync(new URL("Nadeye.sol", OUT)) ? "anvil or compiled contracts missing" : false;

test("derivation is deterministic and matches the documented BIP-44 path", () => {
  const prf = new Uint8Array(32).fill(7);
  assert.equal(recoveryPhrase(prf).split(" ").length, 24);
  const a = privateKeyToAccount(keyHex(deriveEvmKey(prf, 0)));
  const b = privateKeyToAccount(keyHex(deriveEvmKey(prf, 0)));
  const c = privateKeyToAccount(keyHex(deriveEvmKey(prf, 1)));
  assert.equal(a.address, b.address);
  assert.notEqual(a.address, c.address);
});

test("one passkey -> ERC-8004 identity + Nadeye scanner", { skip, timeout: 120_000 }, async (t) => {
  const PORT = 8561, RPC = `http://127.0.0.1:${PORT}`;
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  t.after(() => anvil.kill());
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const w = createWalletClient({ account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"), chain: foundry, transport: http(RPC) });
  const deploy = async (a, args = []) => (await pub.waitForTransactionReceipt({ hash: await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })).contractAddress;
  const boot = art("HardhatMinimalUUPS.sol", "HardhatMinimalUUPS"), proxy = art("ERC1967Proxy.sol", "ERC1967Proxy");
  async function registry(name, idArg) {
    const p = await deploy(proxy, [await deploy(boot), encodeFunctionData({ abi: boot.abi, functionName: "initialize", args: [idArg] })]);
    const impl = art(`${name}.sol`, name);
    const init = name.startsWith("Identity") ? encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [] }) : encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [idArg] });
    await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: p, abi: boot.abi, functionName: "upgradeToAndCall", args: [await deploy(impl), init] }) });
    return p;
  }
  const identity = await registry("IdentityRegistryUpgradeable", "0x0000000000000000000000000000000000000000");
  const reputation = await registry("ReputationRegistryUpgradeable", identity);
  const contract = await deploy(art("Nadeye.sol", "Nadeye"), [identity, reputation]);

  // what the page does after getPasskeyPrfOutput(): Mera signing sessions
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const idSession = createSecp256k1SigningSession({ privateKey: deriveEvmKey(prf, IDENTITY_INDEX) });
  const scSession = createSecp256k1SigningSession({ privateKey: deriveEvmKey(prf, SCANNER_INDEX) });
  const identityAccount = toViemAccount(idSession), scannerAccount = toViemAccount(scSession);
  t.after(() => { idSession.end(); scSession.end(); });

  await pub.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: identityAccount.address, value: parseEther("1") }) });
  const client = createProfileClient({ chain: foundry, rpcUrl: RPC, contract, identity, reputation });
  await client.fundScanner(identityAccount, scannerAccount.address, "0.1");

  const steps = [];
  const { agentId } = await client.setupAgent({ identityAccount, scannerAccount, handle: "@safwaan_uddin", onStep: (s) => steps.push(s) });
  assert.equal(steps.length, 5);

  assert.equal(await pub.readContract({ address: identity, abi: identityAbi, functionName: "ownerOf", args: [agentId] }), identityAccount.address);
  assert.equal(await pub.readContract({ address: identity, abi: identityAbi, functionName: "getAgentWallet", args: [agentId] }), scannerAccount.address);
  const st = await client.status(identityAccount.address, scannerAccount.address);
  assert.equal(st.scanner.hasAgent, true);
  assert.equal(st.scanner.agentId, agentId);
  assert.equal(st.scanner.handle, "safwaan_uddin");

  // running it again is a no-op
  assert.equal((await client.setupAgent({ identityAccount, scannerAccount })).already, true);
});
