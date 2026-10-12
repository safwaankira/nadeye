# Monad Metropolis submission: Nadeye

**Track:** 04 · Trust, Identity & AI Infrastructure
**Bounties to tag:** Monad Foundation "Mera: One Passkey, Many Keys" · Monad Foundation "Best Mera-Powered UX on Monad"
**Network:** Monad testnet (chain 10143); the rules allow mainnet or testnet, and the same code deploys to mainnet unchanged
**Team:** Safwaan Uddin (solo)

---

## Platform deliverables

- [ ] **Project logo or graphic** (JPG, JPEG, PNG or WEBP, 3 MB or less): `brand/nadeye-avatar.png` (1024 × 1024, 12 KB).
- [ ] **Public GitHub repository, fully accessible by metropolis@hackathon.monad.xyz.** Push it with its history (clone `nadeye.bundle`, then push; README step 0), so judges can see it was built in the window.
- [ ] **Technical demo video** (3 minutes or less, on YouTube, Loom or Vimeo, showing the live working product, not slides). Script below, 2:50.
- [ ] **Pitch video** (2 minutes or less, introducing the team, the problem and why you're building it). Script below, about 1:35.
- [ ] **Live product link** on Monad testnet, with the access instructions below ("For judges").
- [ ] **Product advertisement** (optional, 30 seconds or less). Script below.
- [ ] **Portal:** create the team and project, choose Track 4, and tag both Mera bounties.

## Project name
Nadeye (say "nad-eye": naked eye + nads)

## One-liner
An open provenance registry for AI-generated images on Monad: detectors record verdicts by a fingerprint that survives re-encoding, earn ERC-8004 reputation for being right, and prove a passkey stands behind them. Any app, contract or agent can read it.

## Write-up

AI has broken the default assumption that a picture shows something real. People can't reliably spot generated images, and AI agents repost and act on them without checking at all. Today every platform answers "is this AI?" alone, privately, if at all.

**Nadeye is the shared answer, as a protocol.** It has three onchain primitives and two reference clients.

1. **A provenance registry keyed by perceptual hash.** A verdict is stored against the image's 64-bit DCT perceptual hash plus a confidence score, never the image itself. Lookups also try the 36 nearest variants, so resized and recompressed copies still match: 94% of re-encoded copies, against 59% for an exact hash, in our tests. Only confident verdicts become votes: 80% and above counts as AI, below 50% as real, and the uncertain middle never leaves the device.
2. **Reputation for detectors, under ERC-8004.** Any scanner, human or agent, links an ERC-8004 identity. When its verdict meets the consensus check, the Nadeye contract writes 100 (agreed) or 0 (disagreed) to the Reputation Registry. A detector's accuracy becomes a portable, public track record, and readers decide whose verdicts to trust.
3. **Passkey proof, on Monad's P256 precompile.** The `PasskeyRegistry` binds an account to one WebAuthn passkey and verifies the signature onchain through the P256 precompile at `0x100`. It checks user verification, the exact challenge, low-s signatures and replay, and one passkey can back only one scanner. Any contract can call `verifyFor(account, challenge, assertion)` to require a person's passkey for an action.

**Reference clients:**
- **The Chrome extension** runs Sieve's ViT detector on WebGPU, entirely on the device, and shows the community count on any image, on any site.
- **The verifier agent** runs the same model for other agents, over MCP, HTTP, or onchain through the ERC-8004 Validation Registry.

Accounts come from **Mera**: one passkey derives an identity key that owns the ERC-8004 agent and a scanner key that signs verdicts. There is no seed phrase and no custody backend, and the same passkey restores everything on a new device. The same passkey, under a second PRF salt, also encrypts a **private journal** of the images you checked. The journal is stored on Monad as ciphertext and readable only with that passkey, on any device.

**For developers:**
- `nadeye-sdk` (hash an image, look it up, read reputation and passkey status).
- `INadeye.sol`, with a tested example contract that refuses to list community-flagged images.
- The `docs/INTEGRATE.md` guide, with paste-ready code for apps, contracts and agents.

## How it uses Monad

- **P256 precompile.** Passkey proofs are verified onchain for about 35k gas, against about 283k in plain Solidity.
- **ERC-8004.** Monad's Identity, Reputation and Validation registries are the identity and trust layer.
- **Throughput.** A browsing session produces many small attestations. Fast confirmation and low fees make one batch a minute practical, and writes for different images touch disjoint storage, which suits parallel execution.
- **Gas billing.** Monad bills the gas limit, so every client estimates and pads by only 15%.

## Who adopts it, and why

| Adopter | How they integrate | Why Nadeye instead of their own |
| --- | --- | --- |
| AI agents that post, repost or act on media (any MCP client, agent frameworks with plugin systems such as ElizaOS) | MCP `verify_image`, HTTP, or an ERC-8004 validation request | No detector to host; the answer comes with a public track record of the verifier; verdicts are shared across every agent that checks |
| NFT marketplaces, mints and "real photo" galleries on Monad | One `view` call to `INadeye.getImage` (see `ProvenanceGallery.sol`) | Onchain data with no API key or vendor; matching survives the re-encoding marketplaces do |
| Social apps and feeds (Track 3 builders) | `nadeye-sdk` `lookupImage` to label AI images in a feed | A shared registry gets stronger with every scanner; no single platform owns the labels |
| Any app that needs a human to approve an action | `PasskeyRegistry.verifyFor` | WebAuthn verification that is already correct (UV, challenge, low-s, replay) and cheap on the precompile |

## Traction and plan

**Today:**
- Working end to end on a local Monad-equivalent chain and on testnet: extension, site, verifier agent, SDK and the three contracts.
- 50 contract tests, a deep invariant campaign (about 205,000 calls per invariant) and a security review (SECURITY.md).
- The protocol-registry listing for `monad-crypto/protocols` is ready (`ecosystem/`).

**During the hackathon:** offer the SDK and MCP server to other Metropolis teams, especially Track 3 social apps and Track 4 agent projects. One integration is worth more than any feature.

**After the event:**
1. Publish `nadeye-sdk` to npm and an ElizaOS plugin.
2. Invite other detectors (other models, newsroom fact-checkers) to attest, so the registry becomes multi-model and reputation does the weighting.
3. Weight consensus by passkey-proved, high-reputation scanners, and move to mainnet.

## Built during Metropolis

Everything in the repo except Sieve (the detector model and the base extension, by Sriram Kiron, MIT) and the ERC-8004 registry copies vendored for tests. That covers:
- the Nadeye contract;
- the PasskeyRegistry and NadeyeJournal;
- perceptual hashing and near-match lookup;
- the chain client and batching in the extension;
- the verifier agent: Node port of the detector, MCP, HTTP and the ERC-8004 validator;
- Mera passkey identities, the WebAuthn proof flow, the encrypted journal and the scoped signing session;
- the agent's testnet gas drip;
- the site, the SDK, the Solidity interface and example, the docs, and all tests.

The git history shows every commit.

## For judges: access

**Live site:** `<SITE_URL>`. It needs no account or wallet to explore.
- **Leaderboard:** scanners, points and signal-to-noise, with ERC-8004 agent and passkey chips.
- **Registry:** drop any image to see its community verdict. It is hashed in your browser and never uploaded.
- **My scanner:**
  1. Choose **Create passkey** (Touch ID, Windows Hello or a phone).
  2. The agent sends the new identity address a little testnet MON for gas. If it doesn't, use https://faucet.monad.xyz.
  3. Choose **Create ERC-8004 agent**, then **Prove with passkey**, which takes two passkey prompts.
  4. Your scanner now shows the passkey chip.
  5. On **Registry**, check an image and choose **Unlock and save to my journal** with a note. Open the site on another device or in a private window, sign in with the same passkey, and choose **Unlock journal**: the entry decrypts there too.

**Extension:** download `nadeye-extension.zip` from the repo's latest release.
1. Unzip it, open `chrome://extensions`, turn on Developer mode and choose **Load unpacked**.
2. The model (45 MB) downloads once.
3. Browse any page with images: badges appear on images. Turn on **Contribute verdicts** in the popup to record them.

**Agents:** the MCP config and HTTP examples are in `docs/INTEGRATE.md`.

**Test credentials:** none needed. Passkeys are created on your own device, and testnet MON comes from the agent's drip or the faucet.

## Links
- Repo: https://github.com/safwaanDK/nadeye
- Live site: `<SITE_URL>`
- Nadeye (testnet): `<NADEYE_ADDRESS>` · https://testnet.monadvision.com/address/<NADEYE_ADDRESS>
- PasskeyRegistry (testnet): `<PASSKEYS_ADDRESS>`
- NadeyeJournal (testnet): `<JOURNAL_ADDRESS>`
- Verifier agent: ERC-8004 agent #`<id>` · wallet `<address>`
- Demo video: `<link>` · Pitch video: `<link>`

---

## Technical demo video (about 2:50, live product only)

| Time | Show |
| --- | --- |
| 0:00–0:15 | **Problem.** Scroll a feed with a few AI images: "Can you tell with the naked eye? Can your agent?" |
| 0:15–0:50 | **Passkey account and proof.** On the live site, open My scanner and choose Create passkey; show the two derived keys. Create the ERC-8004 agent. Choose **Prove with passkey**, answer the two prompts, and open the `PasskeyRegistered` transaction on the testnet explorer: "verified by Monad's P256 precompile". Point at the session line: these keys only sign for Nadeye and expire. |
| 0:50–1:25 | **Extension.** Browse. Badges appear and an AI image is blurred with `◆ AI 97%`. Open the popup (testnet, agent #id, queue sending) and the batch transaction on the explorer. |
| 1:25–1:45 | **Survives re-encoding.** In a second Chrome profile, a resized copy of the same image shows `◆ AI 96% · 1/1 AI`. |
| 1:45–2:15 | **Agents.** In Claude Desktop, ask "is this image AI-generated? <url>" and it calls `verify_image`. In a terminal, run `request <url>`; the validator answers onchain (`ValidationResponse`). |
| 2:15–2:30 | **Private journal.** Check an image on Registry and save it with a note. In a private window, sign in with the same passkey and unlock the journal: the note decrypts. Show the `NadeyeJournal` transaction: only ciphertext. |
| 2:30–2:40 | **Primitive.** The leaderboard with agent and passkey chips, and `docs/INTEGRATE.md` for a few seconds. |
| 2:40–2:50 | **Close.** "Nadeye: see what the naked eye can't. An open record of what's real, on Monad." |

## Pitch video (about 1:35, 180 words plus your own sentence)

> **Who (0:00–0:15).** I'm Safwaan Uddin, and I built Nadeye, said "nad-eye", solo for Metropolis. *[One sentence, in your own words, on why you care about fake images.]*
>
> **Problem (0:15–0:35).** AI images are now everywhere. People can't reliably tell them apart, and AI agents repost and act on images without checking at all. Every platform answers "is this real?" on its own, privately, if at all.
>
> **What Nadeye is (0:35–1:05).** Nadeye is the shared answer, as an open protocol on Monad. A detector, a browser extension or an AI agent, records its verdict against the image's perceptual hash, a fingerprint that still matches after resizing or recompression. The image itself never leaves the device. Every detector earns ERC-8004 reputation for agreeing with consensus, and can prove a real passkey stands behind it, checked by Monad's P256 precompile.
>
> **Who uses it (1:05–1:30).** Agents ask it before they post, over MCP or onchain. Marketplaces call one function to refuse flagged images. Social apps label their feeds with a small SDK. Nobody hosts a model or trusts a single company.
>
> **Why now, why Monad (1:30–1:45).** Verdicts are many and small: Monad's speed and fees make recording them practical, and ERC-8004 and the P256 precompile are built in.
>
> **Close (1:45–1:50).** Nadeye: see what the naked eye can't.

## Product advertisement (optional, 30 seconds)

> (Feed scrolling, one image glitches into its 8×8 pixel hash.) "Is it real?" (Badge pops: ◆ AI 96%, 3/3 AI.) "Nadeye checks on your device, and remembers on Monad." (A resized copy elsewhere shows the same badge.) "Even when the copy changes." (An agent's terminal: verdict ai.) "For people, and for their agents." (Logo and tagline.) "Nadeye. See what the naked eye can't."

## Bounty notes

- **Mera: One Passkey, Many Keys** (PRF key material used beyond an account). The non-account use is the **private journal**:
  - **Its own namespace.** The passkey's PRF is evaluated under a separate salt, `sha256("nadeye:journal:v1")`. Mera's account salt is different.
  - **Encryption only.** HKDF turns the output into an AES-256-GCM key and an opaque journal id. Neither is a signing key, and neither is linked to the account keys.
  - **On Monad, readable only with the passkey.** Entries are sealed in the browser with the journal id as associated data, then appended to `NadeyeJournal`. A fresh device with only the passkey re-derives both values and decrypts everything (tested in Chromium with a virtual authenticator).
  - **Agent identity too.** In the account namespace, one passkey also derives an *identity* key that owns an ERC-8004 agent and a *scanner* key that is that agent's `agentWallet`. That is two roles from one passkey, not a wallet.
- **Best Mera-Powered UX on Monad.** Mera is the whole account layer: no seed phrase, wallet extension or custody backend. On top of that:
  - **Prompts stay rare.** Signing in is one prompt, and agent setup runs in 4–5 transactions with no further prompts. Only the journal unlock and the passkey proof ask again, and the page says why each time.
  - **Signing is scoped.** The prompt-free keys can only sign for Nadeye's contracts, the ERC-8004 Identity Registry and your own scanner key. Anything else is refused before it is signed (tested).
  - **The session expires visibly.** Keys live in tab memory and are wiped after 10 idle minutes, after an hour at most, or on **Lock now**. The page shows when the session ends.
  - **No faucet detour.** New testnet accounts get gas from the agent's drip, which pays each address once and has per-IP and daily caps.
  - **Errors say what to do,** for example: no PRF support, a dismissed prompt, or no gas.

## Launch post (X)

> Nadeye is live on @monad testnet for #MonadMetropolis.
>
> An open record of which images are AI-generated: detectors verify on-device, verdicts are keyed by a fingerprint that survives re-encoding, and every detector earns ERC-8004 reputation. Passkeys verified onchain by Monad's P256 precompile. No uploads, no seed phrase.
>
> Agents can ask over MCP or ERC-8004 validation, and apps can read it with one call.
>
> Detector: Sieve by @sriramkiron. Repo and demo below.

## Outreach message for other teams (Discord or X)

> Hi! I built Nadeye for Track 4: an open onchain registry of AI-image verdicts on Monad testnet. If your app shows user images or your agent reposts media, you can check an image in a few lines (`nadeye-sdk`'s `lookupImage`, or one `INadeye.getImage` call from a contract, or MCP for agents). It's free to read, and I'm happy to help wire it in today: <repo link>/blob/main/docs/INTEGRATE.md

---

## BuildAnything (same project)

**Category:** choose the one that matches the deployment (testnet).

**Tagline:** See what the naked eye can't. An open, onchain record of which images are AI-generated.

Use the write-up above, trimmed to its first three paragraphs.
