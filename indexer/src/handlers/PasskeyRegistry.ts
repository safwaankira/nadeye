// PasskeyRegistry events -> which scanners proved a passkey on the P256 precompile.
import { indexer } from "envio";
import { scannerOrNew, totals } from "./shared.js";

indexer.onEvent(
  { contract: "PasskeyRegistry", event: "PasskeyRegistered" },
  async ({ event, context }) => {
    const s = await scannerOrNew(context, event.params.account);
    context.Scanner.set({ ...s, passkey: true, passkeyAt: event.block.timestamp });
    if (!s.passkey) { // re-registering (a new passkey) doesn't add a holder
      const t = await totals(context);
      context.Totals.set({ ...t, passkeys: t.passkeys + 1 });
    }
  },
);

indexer.onEvent({ contract: "PasskeyRegistry", event: "PasskeyRemoved" }, async ({ event, context }) => {
  const s = await scannerOrNew(context, event.params.account);
  if (!s.passkey) return;
  context.Scanner.set({ ...s, passkey: false, passkeyAt: undefined });
  const t = await totals(context);
  context.Totals.set({ ...t, passkeys: t.passkeys - 1 });
});
