// Monad reserve balance (docs.monad.xyz/developer-essentials/reserve-balance): an undelegated
// account holding under 10 MON can move value only in a transaction that is its first within
// the last k = 3 blocks (an "emptying" transaction). Otherwise the transfer reverts and still
// pays gas. Before a value transfer, wait until `address` has sent nothing in the last 3 blocks.
export const RESERVE_WINDOW_BLOCKS = 3n;

/**
 * Resolves once no transaction from `address` is pending or was included in the last 3 blocks.
 * Gives up after `timeoutMs` and lets the caller go ahead (local chains without steady block
 * production never advance; on Monad, blocks come every ~400 ms, so this takes about 1-2 s).
 */
export async function waitForReserveWindow(pub, address, { timeoutMs = 8_000, pollMs = 300, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const start = Date.now();
  for (;;) {
    const latest = await pub.getBlockNumber({ cacheTime: 0 });
    const ref = latest > RESERVE_WINDOW_BLOCKS ? latest - RESERVE_WINDOW_BLOCKS : 0n;
    const [before, pending] = await Promise.all([
      pub.getTransactionCount({ address, blockNumber: ref }),
      pub.getTransactionCount({ address, blockTag: "pending" }),
    ]);
    if (before === pending) return true;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(pollMs);
  }
}
