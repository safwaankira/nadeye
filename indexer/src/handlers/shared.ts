// Small helpers shared by the handlers. Thresholds mirror Nadeye.sol.
import type { Scanner, Totals, DailyStat } from "envio";

export const AI_VOTE_BPS = 8000;
export const DAY = 86_400;
export const TOTALS_ID = "nadeye";

/** contract key (bytes32) -> the 16-hex-character pHash the site and SDK show */
export const shortHash = (key: string) => key.slice(-16).toLowerCase();
/** 16-hex-character pHash -> contract key */
export const toKey = (pHash: string) => "0x" + pHash.toLowerCase().padStart(64, "0");

export const majority = (reports: number, aiVotes: number) =>
  aiVotes * 2 === reports ? "split" : aiVotes * 2 > reports ? "ai" : "real";

type Ctx = {
  Scanner: { get: (id: string) => Promise<Scanner | undefined> };
  Totals: { get: (id: string) => Promise<Totals | undefined> };
  DailyStat: { get: (id: string) => Promise<DailyStat | undefined> };
};

export async function scannerOrNew(context: Ctx, id: string): Promise<Scanner> {
  return (await context.Scanner.get(id)) ?? {
    id, handle: undefined, points: 0n, scans: 0, firsts: 0, signal: 0, noise: 0,
    agentId: undefined, passkey: false, passkeyAt: undefined, joined: 0, lastSeen: 0,
  };
}

export async function totals(context: Ctx): Promise<Totals> {
  return (await context.Totals.get(TOTALS_ID)) ?? { id: TOTALS_ID, scans: 0, images: 0, scanners: 0, passkeys: 0, verifierAnswers: 0 };
}

export async function dailyStat(context: Ctx, timestamp: number): Promise<DailyStat> {
  const day = Math.floor(timestamp / DAY);
  return (await context.DailyStat.get(String(day))) ?? { id: String(day), day, scans: 0, aiVotes: 0, newImages: 0, verifierAnswers: 0 };
}
