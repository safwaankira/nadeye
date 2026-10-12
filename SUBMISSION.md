# Monad Metropolis submission: Nadeye

**Track:** 04 · Trust, Identity & AI Infrastructure
**Bounties to tag:** Monad Foundation "Mera: One Passkey, Many Keys" · Monad Foundation "Best Mera-Powered UX on Monad"
**Deadline:** 13 Oct · **Network:** Monad mainnet (chain 143)

---

## Track fit

Track 4 lists three example ideas. Nadeye builds on all three:

| Track 4 example idea | In Nadeye |
| --- | --- |
| "Provenance for generated media that survives re-encoding" | The core: each verdict is keyed by a 64-bit DCT perceptual hash, and lookups also try the 36 nearest variants, so resized and recompressed copies match (94% vs 59% for an exact hash in our tests). |
| "Agent identity and reputation under ERC-8004" | Scanners link ERC-8004 agents. Consensus results are written to the Reputation Registry, and the verifier answers the Validation Registry onchain. |
| "Passkey-native accounts using P256 and WebAuthn, with no seed phrase" | Sign-in is a passkey through Mera, with no seed phrase. Mera turns the passkey's PRF output into Monad keys rather than verifying P256 signatures onchain. |

## Submission checklist

- [ ] **Code with history.** Push the repo with its git history (clone `nadeye.bundle`, then push), so judges can see what was built in the window: 15 commits, all between 11 and 12 Oct. Make it public; the platform rules reportedly also require it to be readable by metropolis@hackathon.monad.xyz.
- [ ] **Working product.** Contract deployed and verified on Monad mainnet, site hosted, verifier agent running (README, "Mainnet runbook").
- [ ] **Demo video, 3 minutes or less.** The script below runs 2:30.
- [ ] **Pitch video, 2 minutes or less.** The script is below.
- [ ] **Logo or graphic, 3 MB or less.** `brand/nadeye-avatar.png` (1024 × 1024, 12 KB); `brand/nadeye-mark.png` has a transparent background.
- [ ] **Portal.** Create the team and project, choose Track 4, and tag both Mera bounties.
- [ ] **Links.** Fill in the Links section below.

The video, graphic and readable-by-email items come from another team's README citing the platform rules. Confirm them on the application platform.

## Project name
Nadeye (say "nad-eye": naked eye + nads)

## One-liner
See what the naked eye can't. Provenance for generated media: people and AI agents verify images on-device, and Monad keeps the record and each verifier's ERC-8004 reputation.

## Write-up

AI-generated images are now part of everyday browsing. People can't easily tell them apart, and AI agents repost and act on them without checking.

Nadeye makes "is this image AI-generated?" a question with a public, verifiable answer.

**People** install the Nadeye Chrome extension. It runs a ViT detector entirely in the browser on WebGPU, so images are never uploaded. Users sign in with a passkey instead of a seed phrase. When they opt in, each verdict goes to Monad as a 64-bit perceptual hash plus a confidence score. Only confident verdicts become votes: 80% and above counts as AI, below 50% as real, and the uncertain middle never leaves the device. Anyone who later meets the same picture on any site, even resized or recompressed, sees how many scanners flagged it, right on the image.

**Agents** call the Nadeye Verifier. It runs the same model on a laptop and offers three ways in:
- an MCP tool (`verify_image`), for agents to check an image before they post or act on it;
- an HTTP API;
- the ERC-8004 Validation Registry: any agent can send a `validationRequest`, and the verifier answers onchain with an authenticity score from 0 to 100 and a hashed report.

**Trust accrues onchain.** Every scanner, human or agent, can link an ERC-8004 identity. When a linked scanner's verdict meets the consensus check, the Nadeye contract writes the outcome to the ERC-8004 Reputation Registry: 100 for agreement, 0 for disagreement. Each detector's accuracy becomes a portable, queryable track record. Points, active days and signal-to-noise rank scanners on a leaderboard that reads straight from the contract, with no backend.

**Mera: one passkey, many keys.** Nadeye derives two keys from one passkey:
- an identity key that owns the ERC-8004 agent. It lives only in page memory, inside Mera signing sessions that are zeroed after each action.
- a scanner key the extension uses to sign. It is registered as the agent's `agentWallet` with its own EIP-712 consent, so a leaked hot key can be rotated without losing reputation.

The same passkey restores everything on a new device.

## How it uses Monad

- **Volume.** A browsing session produces many small attestations. Fast confirmation and low fees are what make one batch per minute practical.
- **Parallel execution.** Writes for different images and different scanners hit disjoint storage, which suits Monad's parallel execution.
- **ERC-8004.** It uses Monad's live Identity, Reputation and Validation registries.
- **Gas billing.** Monad bills the gas limit, so every client estimates each transaction and pads it by only 15%.

## What was built during Metropolis

Everything in the repo except Sieve (the detector and the base extension) and the ERC-8004 registry copies vendored for tests:
- the Nadeye contract with ERC-8004 integration;
- perceptual hashing and near-match lookup;
- the Monad chain client and batching in the extension;
- the verifier agent: Node port of the detector, MCP, HTTP and the ERC-8004 validator;
- Mera passkey identities;
- the leaderboard and registry site;
- all tests.

The detector model and base extension are Sieve by Sriram Kiron (MIT, open source), credited in the README, NOTICE and the app.

## Verification (for judges)

- **Contract:** 34 Foundry tests: unit tests, 7 against the real ERC-8004 reference registries, and a stateful invariant campaign (30,720 calls per invariant) with a hostile registry. The campaign found and fixed one Medium DoS issue (see SECURITY.md).
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
| 1:15–1:35 | **Community verdict.** In a second Chrome profile, a resized copy of the same image shows `◆ AI 96% · 1/1 AI`. |
| 1:35–2:05 | **Agents.** In Claude Desktop, ask "is this image AI-generated? <url>" and it calls `verify_image`. In a terminal, run `request <url>`; the validator log answers; show the `ValidationResponse` event on the explorer. |
| 2:05–2:25 | **Reputation.** Leaderboard: agent chips, points, signal-to-noise. Read the ERC-8004 `getSummary` for your agent. |
| 2:25–2:30 | **Close.** "Nadeye: see what the naked eye can't. Images never leave your device; trust lives on Monad." |

## Pitch video (about 1:50, 223 words spoken)

Talk to camera, or over the site and the cover. Say the name "nad-eye" once, early.

> **Problem (0:00–0:20).** AI images are now part of everyday browsing. People can't reliably tell them apart, and AI agents repost and act on images without checking at all. "Is this real?" has no shared, checkable answer.
>
> **What Nadeye is (0:20–0:45).** Nadeye, said "nad-eye", is a browser extension and a verifier agent. The extension runs an AI-image detector on your own device, so the picture is never uploaded. A confident verdict goes to Monad as a 64-bit perceptual hash, a fingerprint that still matches after the image is resized or recompressed. The next person to meet that image, on any site, sees how many scanners flagged it.
>
> **Agents (0:45–1:10).** Agents use the same detector through MCP, HTTP or ERC-8004's Validation Registry, and get an answer onchain. Every scanner, human or agent, can link an ERC-8004 identity. The Nadeye contract writes each consensus result to the Reputation Registry, so a detector's track record is public and portable.
>
> **No seed phrase (1:10–1:25).** You sign in with a passkey through Mera. One passkey gives you an identity key that owns your agent and a scanner key the extension uses, and recreates both on any device.
>
> **Why Monad (1:25–1:40).** A browsing session produces many small attestations. Monad's fees and fast confirmation make one batch a minute practical, and writes for different images run in parallel.
>
> **Close (1:40–1:50).** Nadeye: see what the naked eye can't. Your images stay on your device, and trust lives on Monad.

## Launch post (X)

> Nadeye is live on @monad mainnet for #MonadMetropolis.
>
> See what the naked eye can't. Detect AI-generated images on-device, then put the verdict onchain. No uploads, and no seed phrase thanks to passkeys via Mera.
>
> Agents can ask too, through MCP or ERC-8004 validation. Verifiers that link an ERC-8004 agent build a public track record.
>
> Detector: Sieve by @sriramkiron. Repo and demo below.

---

## BuildAnything (same project)

**Category:** Mainnet

**Tagline:** See what the naked eye can't. Detect AI images in your browser, share the verdict on Monad.

Use the write-up above, trimmed to its first three paragraphs.
