# Monad Metropolis submission — Nadeye

**Track:** 04 · Trust, Identity & AI Infrastructure
**Bounties to tag:** Monad Foundation "Mera: One Passkey, Many Keys" · Monad Foundation "Best Mera-Powered UX on Monad"
**Deadline:** 13 Oct · **Network:** Monad mainnet (chain 143)

---

## Project name
Nadeye (say "nad-eye": naked eye + nads)

## One-liner
See what the naked eye can't. Provenance for generated media: people and AI agents verify images on-device, and Monad keeps the record and each verifier's ERC-8004 reputation.

## Write-up

AI-generated images are now part of everyday browsing. People can't easily tell them apart, and AI agents repost and act on them without checking.

Nadeye makes "is this image AI-generated?" a question with a public, verifiable answer.

**People** install the Nadeye Chrome extension. It runs a ViT detector entirely in the browser on WebGPU, so images are never uploaded. Users sign in with a passkey instead of a seed phrase. When they opt in, each verdict goes to Monad as a 64-bit perceptual hash plus a confidence score. Anyone who later meets the same picture on any site, even resized or recompressed, sees how many scanners flagged it, right on the image.

**Agents** call the Nadeye Verifier. It runs the same model on a laptop and offers three ways in:
- an **MCP tool** (`verify_image`), for agents to check an image before they post or act on it;
- an **HTTP API**;
- the **ERC-8004 Validation Registry**: any agent can send a `validationRequest`, and the verifier answers onchain with an authenticity score from 0 to 100 and a hashed report.

**Trust accrues onchain.** Every scanner, human or agent, can link an **ERC-8004 identity**. When a verdict meets the consensus check, the Nadeye contract writes the outcome to the **ERC-8004 Reputation Registry**: 100 for agreement, 0 for disagreement. Each detector's accuracy becomes a portable, queryable track record. Points, active days and signal-to-noise rank scanners on a leaderboard that reads straight from the contract, with no backend.

**One passkey, many keys (Mera).** One passkey derives two keys:
- an **identity key** that owns the ERC-8004 agent. It lives only in page memory, inside Mera signing sessions that are zeroed after each action.
- a **scanner key** the extension uses to sign. It is registered as the agent's `agentWallet` with its own EIP-712 consent, so a leaked hot key can be rotated without losing reputation.

The same passkey restores everything on a new device.

## How it uses Monad

- **Volume.** A browsing session produces many small attestations. Fast confirmation and low fees are what make one batch per minute practical.
- **Parallel execution.** Writes for different images and different scanners hit disjoint storage, which suits Monad's parallel execution.
- **ERC-8004.** It uses Monad's live Identity, Reputation and Validation registries.
- **Gas billing.** Monad bills the gas limit, so every client estimates each transaction and pads it by only 15%.

## What was built during Metropolis

Everything in the repo except the detector:
- the Nadeye contract with ERC-8004 integration;
- perceptual hashing and near-match lookup;
- the Monad chain client and batching in the extension;
- the verifier agent: Node port of the detector, MCP, HTTP and the ERC-8004 validator;
- Mera passkey identities;
- the leaderboard and registry site;
- all tests.

The detector model and base extension are **Sieve** by Sriram Kiron (MIT, open source), credited in the README, NOTICE and the app.

## Verification (for judges)

- **Contract:** 31 Foundry tests: unit tests, 7 against the real ERC-8004 reference registries, and a stateful invariant campaign (30,720 calls per invariant) with a hostile registry. The campaign found and fixed one Medium DoS issue (see SECURITY.md).
- **Agent end-to-end on a local chain:** register → validation request → onchain answer → attestation → HTTP and MCP.
- **Extension:** the service worker is tested under a mocked Chrome API.
- **Passkey flow:** tested with real Mera signing sessions.
- **Model parity:** the Node detector matches Sieve's own reference scores (mean |Δ| 0.009).

## Links
- Repo: https://github.com/safwaanDK/nadeye
- Live site: <your Vercel URL>
- Contract (mainnet): <address> · https://monadvision.com/address/<address>
- Verifier agent: ERC-8004 agent #<id> · wallet <address>
- Demo video: <link>

---

## Demo video (2:30)

| Time | Show |
| --- | --- |
| 0:00–0:15 | **Problem.** Scroll a feed with a few AI images and say: "Can you tell with the naked eye? Can your agent?" Then: "This is Nadeye" (say it "nad-eye"). |
| 0:15–0:45 | **Passkey.** On the live site, open My scanner, choose Create passkey (Touch ID) and show the two derived keys. Create the ERC-8004 agent; the progress steps tick by, about a second each on Monad. Click Use in extension and confirm. |
| 0:45–1:15 | **Extension.** Browse. Badges appear and an AI image is blurred with `AI 97%`. Open the popup: mainnet, agent #id, queue sending. Open the last batch transaction on monadvision. |
| 1:15–1:35 | **Community verdict.** In a second Chrome profile, a resized copy of the same image shows `AI 96% · 👥 1/1`. |
| 1:35–2:05 | **Agents.** In Claude Desktop, ask "is this image AI-generated? <url>" and it calls `verify_image`. In a terminal, run `request <url>`; the validator log answers; show the `ValidationResponse` event on the explorer. |
| 2:05–2:25 | **Reputation.** Leaderboard: agent chips, points, signal-to-noise. Read the ERC-8004 `getSummary` for your agent. |
| 2:25–2:30 | **Close.** "Nadeye: see what the naked eye can't. Images never leave your device; trust lives on Monad." |

## Launch post (X)

> Nadeye is live on @monad mainnet for #MonadMetropolis 🟣
>
> See what the naked eye can't. Detect AI-generated images on-device, then put the verdict onchain. No uploads, and no seed phrase thanks to passkeys via Mera.
>
> Agents can ask too, through MCP or ERC-8004 validation. Every verifier earns an ERC-8004 reputation.
>
> Detector: Sieve by @sriramkiron · repo + demo ⬇️

---

## BuildAnything (same project)

**Category:** Mainnet

**Tagline:** See what the naked eye can't. Detect AI images in your browser, share the verdict on Monad.

Use the write-up above, trimmed to its first three paragraphs.
