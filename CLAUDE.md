# Nadeye: notes for Claude Code

Nadeye is an open registry for AI-generated images on Monad testnet. Detectors record verdicts by perceptual hash, earn ERC-8004 reputation, and can prove a passkey onchain. It was submitted to Monad Metropolis (Track 4, plus the Envio and Mera bounties). See README.md for the full design and SUBMISSION.md for the submission text.

## Working with the owner
- The owner is Safwaan, a solo vibe coder. Keep replies short, answer first, and give one step at a time when walking him through something.
- Commit as `Safwaan Uddin <safwaanuddin@gmail.com>`. Vercel blocks deploys from noreply commit authors.
- **Commit and push at a normal pace.** The previous GitHub account (safwaanDK) was suspended after a burst of automated commits and pushes. Batch work into a few meaningful commits and push rarely. Don't install the Claude GitHub app on this account.
- Repo: github.com/safwaankira/nadeye (`main`). Local clone on the owner's Mac: `~/nadeye`.

## Layout
- `contracts/`: Foundry. `Nadeye.sol` (registry + ERC-8004 reputation writes), `PasskeyRegistry.sol` (WebAuthn on the P256 precompile at 0x0100), `NadeyeJournal.sol` (encrypted journal). `forge test`.
- `extension/`: Chrome MV3 extension (Sieve detector on WebGPU/WASM, pHash, chain client). `npm run build`, `npm test`. Chrome loads it unpacked from `~/nadeye/extension`; reload it in chrome://extensions after a build.
- `web/`: static site (Leaderboard, Registry, My scanner, Activity). `node build.mjs` writes `web/dist`; `npm test`; browser e2e with `npm run e2e`.
- `agent/`: verifier agent (HTTP, MCP, ERC-8004 validator, optional gas drip). `npm run serve -- --validator`. It runs locally on the Mac and is optional.
- `indexer/`: Envio HyperIndex 3.13 (config.yaml, schema.graphql, src/handlers). `npm test` (runs codegen first).
- `sdk/`, `docs/INTEGRATE.md`, `ecosystem/`: developer kit and protocol listing.

## Live deployment (Monad testnet, chain 10143)
- Nadeye `0xD58eb04fb34E9b9151484BE82F2114B75323cDD5`
- PasskeyRegistry `0x16Bef696F687aC253d38B7eA4c84075375EB31B3`
- NadeyeJournal `0x3EDd9026A3ad114c67F6cF50EA00e7C93F740a18`
- ERC-8004 agents: scanner #2281 (owner), verifier #2282 (wallet `0x11B8524Cb25E6B2000a644ac7C9B4bcfdf064B5F`), requester #2283
- Site: https://nadeye.vercel.app. Deploy with `cd web && node build.mjs && npx vercel deploy dist --prod` (Vercel CLI is logged in by email).
- Envio indexer: https://indexer.dev.hyperindex.xyz/d4f25ad/v1/graphql. Envio Cloud org `safwaandk`, Development plan, all 3/3 deployment slots used, so don't delete any. The Envio project was linked to the old suspended GitHub repo, so pushes to the new repo don't redeploy it.
- Extension release v1.0.0 (`nadeye-extension.zip`) is on the new repo's Releases page.

## Monad gotchas
- **Reserve balance:** an account under 10 MON can only move value in its first transaction within 3 blocks. Use `waitForReserveWindow` (`web/src/reserve.js`) before value transfers, and always check receipts.
- **Gas is billed on the limit:** estimate and pad by 15%, not 2x.
- The public RPC (`testnet-rpc.monad.xyz`) has timeouts and outages. The validator already retries with backoff.

## Before handing work back
Run the tests for every package you touched. In `extension/`, the C2PA test "detects C2PA trainedAlgorithmicMedia URI anywhere in head" is a known upstream failure. A plain `npm run build` in `extension/` bakes in the live contract and site; override with `NADEYE_TESTNET_CONTRACT` and `NADEYE_SITE`.
