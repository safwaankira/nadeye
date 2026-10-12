// The indexer must agree with the contract. Runs the real Nadeye.sol on anvil, has several
// scanners attest a few hundred verdicts (single and batched, repeats across UTC days), then
// feeds the real logs through the handlers and compares every image and scanner with what the
// contract itself returns from getImage / getScanner / stats.
import { describe, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createTestIndexer } from "envio";
import { createPublicClient, createTestClient, createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const ART = new URL("../../contracts/out/Nadeye.sol/Nadeye.json", import.meta.url);
const ready = spawnSync("anvil", ["--version"]).status === 0 && existsSync(ART);
const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
];

describe.skipIf(!ready)("indexer vs the Nadeye contract", () => {
  it("every image and scanner tally matches the chain", { timeout: 180_000 }, async (t) => {
    const PORT = 8611, RPC = `http://127.0.0.1:${PORT}`;
    const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    try {
      const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
      for (let i = 0; i < 80; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
      const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
      const art = JSON.parse(readFileSync(ART, "utf8"));
      const wallets = KEYS.map((k) => createWalletClient({ account: privateKeyToAccount(k), chain: foundry, transport: http(RPC) }));
      const zero = "0x0000000000000000000000000000000000000000";
      const deploy = await wallets[0]!.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [zero, zero] });
      const nadeye = (await pub.waitForTransactionReceipt({ hash: deploy })).contractAddress!;

      // deterministic pseudo-random workload over 40 images
      let s = 7;
      const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const img = (i: number): Hex => `0x${(0xabc000 + i).toString(16).padStart(64, "0")}`;
      const score = () => (rnd() < 0.55 ? 8000 + Math.floor(rnd() * 2001) : Math.floor(rnd() * 5000));
      // each transaction is mined before the next is sent, so the workload is the same every run
      const mined = async (h: Promise<Hex>) => { await pub.waitForTransactionReceipt({ hash: await h }); };
      for (let round = 0; round < 3; round++) {
        for (const [w, wallet] of wallets.entries()) {
          if (w === 1 && round === 0) await mined(wallet.writeContract({ address: nadeye, abi: art.abi, functionName: "setHandle", args: ["second_scanner"] }));
          const picks = [...new Set(Array.from({ length: 12 }, () => Math.floor(rnd() * 40)))];
          if (rnd() < 0.5) {
            await mined(wallet.writeContract({ address: nadeye, abi: art.abi, functionName: "attestBatch", args: [picks.map(img), picks.map(score), 7] }));
          } else {
            for (const p of picks.slice(0, 4)) {
              const already = await pub.readContract({ address: nadeye, abi: art.abi, functionName: "hasAttested", args: [img(p), wallet.account.address] });
              if (!already) await mined(wallet.writeContract({ address: nadeye, abi: art.abi, functionName: "attest", args: [img(p), score(), 7] }));
            }
          }
        }
        await testClient.increaseTime({ seconds: 86_400 }); // next UTC day
        await testClient.mine({ blocks: 1 });
      }

      // the chain's logs -> simulated events, with real block numbers, timestamps, hashes, log indexes
      type Decoded = { eventName: string; args: unknown; blockNumber: bigint; transactionHash: Hex; logIndex: number };
      const logs = parseEventLogs({ abi: art.abi, logs: await pub.getLogs({ address: nadeye, fromBlock: 0n }) }) as unknown as Decoded[];
      const blocks = new Map<bigint, number>();
      for (const l of logs) if (!blocks.has(l.blockNumber)) blocks.set(l.blockNumber, Number((await pub.getBlock({ blockNumber: l.blockNumber })).timestamp));
      const simulate = logs.filter((l) => ["Attested", "HandleSet", "AgentLinked", "AgentUnlinked"].includes(l.eventName)).map((l) => ({
        contract: "Nadeye" as const, event: l.eventName as "Attested", params: l.args as never,
        block: { number: Number(l.blockNumber), timestamp: blocks.get(l.blockNumber)! },
        transaction: { hash: l.transactionHash }, logIndex: l.logIndex, srcAddress: nadeye,
      }));
      t.expect(simulate.filter((e) => e.event === "Attested").length).toBeGreaterThan(80);

      const indexer = createTestIndexer();
      await indexer.process({ chains: { 10143: { simulate } } });

      const images = await indexer.Image.getAll();
      for (const im of images) {
        const c = await pub.readContract({ address: nadeye, abi: art.abi, functionName: "getImage", args: [im.id] }) as { reports: number; aiVotes: number; meanScore: number; firstScanner: string; firstSeen: number; lastSeen: number };
        t.expect({ reports: im.reports, aiVotes: im.aiVotes, mean: Number(im.scoreSum / BigInt(im.reports)), first: im.firstScanner_id, firstSeen: im.firstSeen, lastSeen: im.lastSeen }, im.pHash)
          .toEqual({ reports: c.reports, aiVotes: c.aiVotes, mean: c.meanScore, first: c.firstScanner, firstSeen: Number(c.firstSeen), lastSeen: Number(c.lastSeen) });
      }
      for (const sc of await indexer.Scanner.getAll()) {
        const c = await pub.readContract({ address: nadeye, abi: art.abi, functionName: "getScanner", args: [sc.id] }) as { handle: string; points: bigint; scans: number; firsts: number; signal: number; noise: number; joined: number };
        t.expect({ handle: sc.handle ?? "", points: sc.points, scans: sc.scans, firsts: sc.firsts, signal: sc.signal, noise: sc.noise, joined: sc.joined }, sc.id)
          .toEqual({ handle: c.handle, points: c.points, scans: c.scans, firsts: c.firsts, signal: c.signal, noise: c.noise, joined: Number(c.joined) });
      }
      const [scans, imageCount, scanners] = await pub.readContract({ address: nadeye, abi: art.abi, functionName: "stats" }) as bigint[];
      const totals = await indexer.Totals.getOrThrow("nadeye");
      t.expect({ scans: totals.scans, images: totals.images, scanners: totals.scanners }).toEqual({ scans: Number(scans), images: Number(imageCount), scanners: Number(scanners) });
      t.expect(images.length).toBe(Number(imageCount));
      const days = await indexer.DailyStat.getAll();
      t.expect(days.length).toBeGreaterThanOrEqual(3);
      t.expect(days.reduce((a, d) => a + d.scans, 0)).toBe(Number(scans));
    } finally {
      anvil.kill();
    }
  });
});
