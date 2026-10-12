// Testnet gas drip: new Nadeye accounts get a little testnet MON from the agent's wallet so
// their first actions (agent setup, passkey proof, journal) work without a faucet detour.
//
// Off unless NADEYE_DRIP=1, and refused outright on mainnet. Each address is paid once, ever
// (recorded on disk); each client IP and the whole service have daily caps; addresses that
// already hold gas or are contracts are skipped; the agent wallet never goes below its floor.
// Sends run one at a time, so concurrent requests can't race the caps or the nonce.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { isAddress, getAddress, parseEther, formatEther } from "viem";

const DAY = 24 * 60 * 60_000;

export class DripError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * @param cfg   { network, drip: { enabled, amount, perIpPerDay, perDay, file }, validatorMinBalanceWei }
 * @param pub   { getBalance({address}), getCode({address}) }
 * @param send  async (to, valueWei) => txHash   (the agent wallet)
 * @param from  the agent wallet address (for the floor check)
 */
export function createDrip({ cfg, pub, send, from, now = () => Date.now() }) {
  const d = cfg.drip || {};
  const enabled = !!d.enabled && cfg.network === "testnet";
  const amount = parseEther(String(d.amount ?? "0.1"));
  const perIp = d.perIpPerDay ?? 3, perDay = d.perDay ?? 25;
  const floor = (cfg.validatorMinBalanceWei ?? 0n) + amount;

  let paid = new Set();
  if (d.file && existsSync(d.file)) {
    try { paid = new Set(JSON.parse(readFileSync(d.file, "utf8")).paid || []); } catch { /* start fresh */ }
  }
  const save = () => {
    if (!d.file) return;
    mkdirSync(dirname(d.file), { recursive: true });
    writeFileSync(d.file, JSON.stringify({ paid: [...paid] }));
  };
  let recent = []; // { at, ip }
  let queue = Promise.resolve();

  async function grant(rawAddress, ip) {
    if (!enabled) throw new DripError(404, "The drip is off on this agent");
    if (typeof rawAddress !== "string" || !isAddress(rawAddress, { strict: false })) throw new DripError(400, "Send {\"address\": \"0x…\"}");
    const to = getAddress(rawAddress);
    const t = now();
    recent = recent.filter((r) => t - r.at < DAY);
    if (paid.has(to.toLowerCase())) throw new DripError(409, "This address already got its testnet MON");
    if (recent.filter((r) => r.ip === ip).length >= perIp) throw new DripError(429, "Daily limit reached for your network");
    if (recent.length >= perDay) throw new DripError(429, "Today's testnet MON is used up");
    if ((await pub.getCode({ address: to }))?.length > 2) throw new DripError(400, "Only regular accounts can receive the drip");
    if ((await pub.getBalance({ address: to })) >= amount) throw new DripError(409, "This address already has enough MON for gas");
    if ((await pub.getBalance({ address: from })) < floor) throw new DripError(503, "The agent's wallet is low");

    // reserve before sending so a failure mid-send can't be retried into a double payment
    paid.add(to.toLowerCase());
    recent.push({ at: t, ip });
    save();
    try {
      const hash = await send(to, amount);
      return { address: to, amount: `${formatEther(amount)} MON`, tx: hash };
    } catch (e) {
      paid.delete(to.toLowerCase());
      recent = recent.filter((r) => !(r.at === t && r.ip === ip));
      save();
      throw new DripError(502, "Sending failed, try again later");
    }
  }

  return {
    enabled,
    /** serialized: one decision and send at a time */
    request(address, ip) {
      const p = queue.then(() => grant(address, ip));
      queue = p.catch(() => {});
      return p;
    },
  };
}
