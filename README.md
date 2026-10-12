# Nadeye

**See what the naked eye can't.** Provenance for generated media, verified by people and agents on Monad.

*Nadeye* (say "nad-eye") is a play on "naked eye" plus Monad's "nads": everyone who scans adds another pair of eyes.

Nadeye is a trust layer for images:

- **People** run a Chrome extension that detects AI-generated images on their own device. They sign in with a passkey (no seed phrase).
- **AI agents** call the Nadeye Verifier over MCP, HTTP or the ERC-8004 Validation Registry. They use it to check an image before they repost it or act on it.
- **Monad** holds the shared record. Each verdict is stored as a 64-bit perceptual hash plus a confidence score, never the image. Each scanner's accuracy against the consensus is written to its **ERC-8004** agent reputation.

```
  Chrome extension (people)                    Nadeye Verifier (agents, runs on a Mac)
  Sieve model on WebGPU/WASM                   same model, onnxruntime-node
  passkey -> scanner key (Mera)                MCP verify_image · HTTP /verify
        │ attestBatch(pHash, score)                  │ attest + validationResponse
        ▼                                            ▼
 ┌────────────────────────────── Monad ──────────────────────────────┐
 │ Nadeye.sol  verdicts by pHash · points · active days · SNR     │
 │      │ consensus judgement (agree 100 / disagree 0)                │
 │      ▼                                                             │
 │ ERC-8004 Reputation Registry   ERC-8004 Identity   ERC-8004 Validation │
 └────────────────────────────────────────────────────────────────────┘
        ▲ reads (no backend)
  Leaderboard + registry site · "My scanner" passkey profile
```

Built for **Monad Metropolis, Track 4: Trust, Identity & AI Infrastructure**. The build touches all three of the track's example ideas: provenance for generated media, agent identity and reputation under ERC-8004, and passkey-native accounts.

## What's in the repo

| Path | What it is |
| --- | --- |
| `contracts/` | `Nadeye.sol`: verdict registry, points, active days, signal-to-noise, ERC-8004 agent linking, and consensus feedback to the ERC-8004 Reputation Registry. 34 Foundry tests, including tests against the real ERC-8004 reference registries. |
| `extension/` | Chrome MV3 extension. Detection is Sieve. Nadeye adds perceptual hashing, the Monad client, batching, community badges, the agent/reputation display and the passkey-site bridge. |
| `agent/` | **Nadeye Verifier**: a Node agent that runs on a Mac. It runs the same model locally, serves an MCP server (stdio + HTTP), an HTTP API and an ERC-8004 registration file, and answers ERC-8004 validation requests onchain. |
| `web/` | Leaderboard, registry lookup and the **My scanner** passkey profile (Mera). It has no backend and reads the chain directly. |

## Credits

The detection model and the extension it ships in are **[Sieve](https://github.com/Phineas1500/sieve-ai-image-detector)** by **Sriram Kiron (@sriramkiron, GitHub @Phineas1500)**. Sieve is MIT licensed and reports 91.3% balanced accuracy on clean images and 87.3% on web-degraded ones, at a 65% threshold. Sieve builds on [Community Forensics](https://github.com/JeongsooP/Community-Forensics) (Park & Owens, CVPR 2025, MIT).

Other third-party code:
- [ERC-8004 reference registries](https://github.com/erc-8004/erc-8004-contracts) (MIT). These are vendored only for local tests; production uses the live Monad deployments.
- [Mera](https://mera.category.xyz/) by Category Labs (MIT/Apache-2.0).
- viem, ONNX Runtime, OpenZeppelin and the MCP SDK.

Everything else in this repo was written during the Metropolis build window (see the git history and `NOTICE`).

---

## Mainnet runbook (Mac, about an hour)

You need Node ≥ 20, [Foundry](https://book.getfoundry.sh/getting-started/installation), Chrome, and about **3 MON on Monad mainnet**. That covers deploying, the agent's gas and your passkey identity.

### 1. Wallets

```bash
cast wallet import deployer --interactive     # your deployer (or use --ledger)
cast wallet new                               # a fresh, dedicated key for the verifier agent
```

Send about 1 MON to the agent address. Keep the deployer separate. Never paste a funded main wallet key anywhere.

### 2. Deploy the contract

```bash
cd contracts
forge build && forge test                    # 34 passing
forge script script/Deploy.s.sol --rpc-url monad_mainnet --account deployer --broadcast
```

The script wires in Monad's live ERC-8004 registries: Identity `0x8004A169…a432` and Reputation `0x8004BAa1…9b63`. It refuses to deploy if they aren't there. Verify the source with Monad's [Foundry verification guide](https://docs.monad.xyz/guides/verify-smart-contract/foundry) (chain id 143).

### 3. Host the site

```bash
cd web && npm install
node build.mjs 0xYOUR_NADEYE mainnet      # bundles the passkey module, writes web/dist/
npx vercel deploy dist --prod                 # or Netlify / GitHub Pages
```

Passkeys are bound to the domain, so pick the final domain before anyone signs in.

### 4. Build and load the extension

```bash
cd extension && npm install && npm run build
```

1. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `extension/`.
2. Download the model when the setup tab opens.
3. Open **Options**:
   - Paste the contract under **Network override** (mainnet), or put it in `src/chain/config.js` and rebuild.
   - Add your site's origin (e.g. `https://nadeye.vercel.app`) under **Trusted Nadeye sites**.

### 5. Sign in with a passkey

On the site, open **My scanner**:

1. Choose **Create passkey**.
2. Fund the identity address with about 0.3 MON.
3. Choose **Create ERC-8004 agent** and enter your handle. This takes 4–5 transactions. The identity key registers the agent, your scanner key becomes its `agentWallet` with its own EIP-712 consent, and the scanner links it in Nadeye.
4. Choose **Use in extension**, then confirm the dialog the extension shows.

In the extension popup, turn on **Contribute verdicts** and browse.

### 6. Run the verifier agent

```bash
cd agent
npm install                                   # macOS arm64 binaries for onnxruntime + sharp
cp .env.example .env                          # set NADEYE_CONTRACT and AGENT_PRIVATE_KEY
npm run register -- --handle nadeye_verifier   # ERC-8004 agent + link; prints AGENT_ID
echo "AGENT_ID=<id>" >> .env
npm run serve -- --validator                  # HTTP + MCP on 127.0.0.1:8787, validator loop
```

The first run downloads Sieve's pinned weights (~45 MB) and checks their sha256.

**Use it from Claude Desktop or Claude Code.** Add this to the MCP config:

```json
{
  "mcpServers": {
    "nadeye": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/nadeye/agent/src/cli.js", "mcp"],
      "env": { "NADEYE_NETWORK": "mainnet", "NADEYE_CONTRACT": "0xYOUR_NADEYE" }
    }
  }
}
```

The tools are `verify_image(url)`, `verify_image_file(path)` (stdio only) and `lookup_phash(pHash)`.

**Ask it onchain**, as another agent would:

```bash
REQUESTER_PRIVATE_KEY=0x… node src/cli.js request https://example.com/image.jpg --validator <agent wallet>
```

The validator answers within seconds with `validationResponse(requestHash, authenticity 0–100, data: JSON report, keccak256(report), "nadeye/ai-image")`.

**Optional public endpoint.** Run `cloudflared tunnel --url http://127.0.0.1:8787`, then re-run `register --public-url https://…`. That puts the MCP and HTTP endpoints into the agent's ERC-8004 registration file.

---

## How it works

### Perceptual hash

Each image gets a 64-bit DCT pHash: luma, area-averaged to 32×32, a 2-D DCT, then the 8×8 lowest frequencies, with each bit set when the coefficient is above the median. The hash is stored as `bytes32`.

Lookups query the hash plus every 1- and 2-bit flip among its 8 least-stable bits. That is 37 keys in one `eth_call`. On re-encoded copies (resize, JPEG q40–85, WebP q50), this found 94% of matches, versus 59% for an exact-hash lookup.

### What counts as a vote

The badge flags an image at 65% AI confidence, Sieve's calibrated threshold. An onchain vote is public and permanent, so it needs more:

| Score | Badge | Onchain |
| --- | --- | --- |
| 80% and above | ◆ AI | AI vote |
| 65–80% | ◆ AI | not recorded |
| 50–65% | ▲ Unsure | not recorded |
| below 50% | ● Real | real vote |

On Sieve's 36,355-image benchmark, flagged scores between 65% and 80% are wrong about 10–12% of the time; scores of 80% and above, about 1–2%. The contract enforces the bands (`AI_THRESHOLD = 8000`, `REAL_CEILING = 5000`): a single `attest` in between reverts with `UnsureScore`, and a batch skips it. The extension and the agent never send those scores.

### Points and signal-to-noise

| Event | Points |
| --- | --- |
| Verdict recorded | +10 |
| First to record the image | +25 |
| Agrees with the existing majority (≥2 prior reports, no tie) | +15 |
| Disagrees | 0, counted as noise |
| Point-earning verdicts per address per UTC day | 300 cap |

### ERC-8004

- **Identity.** A scanner calls `linkAgent(agentId)` and must be the agent's owner or its `agentWallet`. That means nobody can attach someone else's scanner to their agent. The passkey flow uses a cold owner key and a hot `agentWallet` scanner key, so a leaked extension key can be rotated out by the owner.
- **Reputation.** Every consensus judgement on a linked scanner's verdict calls `giveFeedback(agentId, 100 | 0, 0, "nadeye", "consensus", "", "", pHash)`, with the Nadeye contract as the client. `getSummary(agentId, [Nadeye], "nadeye", "consensus")` then equals the scanner's agreement rate. Feedback never blocks an attestation: a broken link or a registry failure just skips it.
- **Validation.** The verifier answers `validationRequest`s addressed to its wallet. The response is an authenticity score: 100 means no sign of AI, 0 means AI-generated. The report is attached as a data URI with its keccak256 hash.

### Passkeys (Mera)

The passkey's PRF output gives a 24-word mnemonic, from which BIP-44 derives:
- `m/44'/60'/0'/0/0` — the **identity key**. It lives only in page memory, inside Mera signing sessions that are ended after every action.
- `m/44'/60'/0'/0/1` — the **scanner key**. It is handed to the extension through a content-script bridge that only trusted origins can use, and the user confirms each time.

The same passkey re-derives the same accounts on any device. The recovery phrase is available from the page in case the domain ever changes.

### The detector

The model is Sieve's ViT-S/16 fine-tune. Its preprocessing lives in `extension/src/pipeline.js`, which is shared by the extension and the agent.

The Node agent matches Sieve's own Python/PIL reference scores on Sieve's 17 labelled sample images: mean |Δ| 0.009, worst 0.049. Sieve's own parity bar is a mean below 0.03 and a worst case below 0.2.

### Why Monad

- Attesting what you browse means a constant stream of small writes. That needs very low fees and roughly one-second confirmation.
- Writes for different images and scanners touch different storage slots, which suits Monad's parallel execution.
- The live ERC-8004 registries give identity and reputation without new infrastructure.
- Monad bills the gas **limit**, so every client estimates and pads by only 15%.
- The P256 precompile (`0x0100`) is an upgrade path to smart accounts with passkey signers.

Measured gas: about 110–140k per newly attested image. A judged verdict from a linked agent costs more, because it also writes the ERC-8004 feedback. That is why the extension caps batches at 50.

## Design

Nadeye's design system builds on Monad's brand kit:
- **Color:** Monad purple, lavender and night, with Monad's pink, cyan and orange as the AI / real / unsure verdict colors.
- **Type:** Inter for body text, Roboto Mono for labels and buttons, and Hanken Grotesk standing in for Britti Sans on headlines.
- **Motif:** the 8×8 pixel grid of a perceptual hash, which is also the logo.

Tokens and component styles are in `design/`, and the brand book is `design/README.md`.

For coding agents, [`DESIGN.md`](DESIGN.md) holds the whole system in Google's [DESIGN.md](https://github.com/google-labs-code/design.md) format: exact tokens plus the rules for using them. It passes the format's linter with no warnings, including WCAG contrast on every component pair. `design/lint.sh` re-checks it and refreshes the Tailwind v3/v4 and DTCG exports in `design/`.

## Security review

The contract passed a stateful invariant fuzz campaign: 6 invariants, each held across 30,720 random calls, including against a hostile ERC-8004 registry. The campaign found and fixed one Medium issue: a gas-burning reputation registry could block attestations. The live ERC-8004 registries on Monad mainnet were audited too. They match the source Nadeye is tested against, and REA confirms the function selectors from bytecode. Nadeye's feedback call fits its 300k gas stipend at Monad prices, with a worst case of 264k. A single key can upgrade all three registries, and Nadeye contains the damage if one is upgraded. See [SECURITY.md](SECURITY.md).

## Privacy and safety

- Images never leave the device in the extension. The agent fetches images only when asked to.
- The agent refuses URLs that resolve to private, loopback or link-local addresses, follows at most 3 redirects, caps size at 25 MB and time at 15 s, and binds to 127.0.0.1 by default.
- Contributing verdicts is off by default. When it's on, the hash, score, model byte, scanner address and time are public and permanent.

## Known limits

- **Sybil resistance.** The daily cap and consensus scoring raise the cost of farming points, but they don't stop it. ERC-8004 reputation lets readers choose which scanners to trust; stake-weighted consensus is the next step.
- **Signal-to-noise** judges each verdict against the majority at the time it was recorded. It is not recomputed later.
- **pHash** doesn't survive heavy crops, rotation or mirroring.
- **Mera's PRF requirement.** Desktop Chrome supports it only for passkeys saved in Google Password Manager.
- **Upstream test.** One Sieve unit test (C2PA URI in head) also fails on Sieve's own `main`. Nadeye doesn't modify `forensics.js`.

## Tests

```bash
cd contracts && forge test     # 34 incl. 6 invariants (30,720 calls each) + hostile-registry tests; points, quorum, ties, cap, batching, paging, fuzz, ERC-8004 link/feedback/rotation
cd extension && npm test       # pHash robustness, chain e2e on anvil, real service worker under mocked chrome incl. bridge origin checks
cd agent && npm test           # register -> validationRequest -> validator answers onchain -> attest -> HTTP + MCP; SSRF guard
cd web && npm test             # passkey derivation + Mera sessions -> ERC-8004 agent with agentWallet -> linked scanner
```

The chain tests run against anvil with the ERC-8004 reference registries deployed the same way as on Monad (proxy → MinimalUUPS → upgrade).

## License

MIT. See `LICENSE` (Nadeye) and `LICENSE.sieve` (Sieve).
