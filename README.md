# Nadeye

**See what the naked eye can't.** Provenance for generated media, verified by people and agents on Monad.

*Nadeye* (say "nad-eye") is a play on "naked eye" plus Monad's "nads": everyone who scans adds another pair of eyes.

Nadeye is an open provenance protocol for images: three onchain primitives, plus reference clients and a developer kit.

- **Registry.** Each verdict is stored as a 64-bit perceptual hash plus a confidence score, never the image, so resized and recompressed copies still match.
- **Reputation.** Each scanner's accuracy against the consensus is written to its **ERC-8004** agent reputation.
- **Passkey proof.** `PasskeyRegistry` binds a scanner to a WebAuthn passkey, verified by Monad's **P256 precompile**, and any contract can require a passkey's approval through `verifyFor`.
- **People** run a Chrome extension that detects AI-generated images on their own device, and sign in with a passkey (Mera, no seed phrase). The same passkey keeps a **private journal** of images they checked, encrypted on their device and stored on Monad.
- **AI agents** call the Nadeye Verifier over MCP, HTTP or the ERC-8004 Validation Registry, to check an image before they repost it or act on it.
- **Developers** read it with `nadeye-sdk` or one `INadeye` call. See [docs/INTEGRATE.md](docs/INTEGRATE.md).

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

Built for **Monad Metropolis, Track 4: Trust, Identity & AI Infrastructure**, on Monad testnet. It uses the track's named building blocks: the P256 precompile for WebAuthn verification, and ERC-8004 for agent identity, reputation and validation.

## What's in the repo

| Path | What it is |
| --- | --- |
| `contracts/` | `Nadeye.sol`: verdict registry, points, active days, signal-to-noise, ERC-8004 agent linking, and consensus feedback to the ERC-8004 Reputation Registry. `PasskeyRegistry.sol`: WebAuthn/P256 passkey proofs on the precompile. `NadeyeJournal.sol`: append-only storage for passkey-encrypted journals. `interfaces/INadeye.sol` and `examples/ProvenanceGallery.sol` for integrators. 50 Foundry tests, including tests against the real ERC-8004 reference registries. |
| `extension/` | Chrome MV3 extension. Detection is Sieve. Nadeye adds perceptual hashing, the Monad client, batching, community badges, the agent/reputation display and the passkey-site bridge. |
| `agent/` | **Nadeye Verifier**: a Node agent that runs on a Mac. It runs the same model locally, serves an MCP server (stdio + HTTP), an HTTP API and an ERC-8004 registration file, and answers ERC-8004 validation requests onchain. On testnet it can also give new site accounts a little gas MON (`POST /drip`, opt-in). |
| `web/` | Leaderboard, registry lookup and the **My scanner** passkey profile (Mera): the onchain passkey proof, the private journal and a time-limited, scoped signing session. It has no backend and reads the chain directly. |
| `indexer/` | **Envio HyperIndex** indexer for Monad: every verdict, scanner, passkey proof and verifier-agent answer (ERC-8004 Validation Registry), plus daily and global aggregates, behind one GraphQL API. It powers the site's **Activity** tab. |
| `sdk/` | `nadeye-sdk`: hash an image, look up its community verdict, read scanners' reputation and passkey status, or ask a verifier agent. |
| `docs/` | `INTEGRATE.md`: paste-ready integrations for apps, contracts and agents. |
| `brand/` | The Nadeye eye mark (SVG and PNG): `nadeye-avatar` on night, with the verdict-colour pupil, and `nadeye-mark` on a transparent ground. |
| `ecosystem/` | Nadeye's entry for Monad's protocol registry and the steps to submit it. |

## Credits

The detection model and the extension it ships in are **[Sieve](https://github.com/Phineas1500/sieve-ai-image-detector)** by **Sriram Kiron (@sriramkiron, GitHub @Phineas1500)**. Sieve is MIT licensed and reports 91.3% balanced accuracy on clean images and 87.3% on web-degraded ones, at a 65% threshold. Sieve builds on [Community Forensics](https://github.com/JeongsooP/Community-Forensics) (Park & Owens, CVPR 2025, MIT).

Other third-party code:
- [ERC-8004 reference registries](https://github.com/erc-8004/erc-8004-contracts) (MIT). These are vendored only for local tests; production uses the live Monad deployments.
- [Mera](https://mera.category.xyz/) by Category Labs (MIT/Apache-2.0).
- viem, ethers, ONNX Runtime, OpenZeppelin, undici and the MCP SDK.

Everything else in this repo was written during the Metropolis build window (see the git history and `NOTICE`).

---

## Runbook: Monad testnet (Mac, about an hour)

You need Node ≥ 20, [Foundry](https://book.getfoundry.sh/getting-started/installation), Chrome, and about **1.5 testnet MON** from the [Monad faucet](https://faucet.monad.xyz). Deploying the three contracts uses about 4.6M gas. Monad charges for the gas limit, and Foundry sets that 30% above the estimate, so budget about 0.6 MON at Monad's 100-gwei minimum base fee. The rest covers the verifier agent, your passkey profile and, if you turn it on, the drip for new accounts. For mainnet, use `monad_mainnet` and `mainnet` wherever `testnet` appears below; the scripts pick the matching ERC-8004 registries by chain ID.

### 0. Publish the code with its history

Judges check what was built during the window, and the commit history is the evidence, so push the repository itself rather than an archive:

```bash
git clone nadeye.bundle nadeye && cd nadeye
git remote set-url origin https://github.com/safwaanDK/nadeye.git   # an empty public repo you created
git push -u origin main
```

Make the repository public; judges must be able to read it (metropolis@hackathon.monad.xyz).

### 1. Wallets

```bash
cast wallet import deployer --interactive     # a deployer key (or use --ledger)
cast wallet new                               # a fresh, dedicated key for the verifier agent
```

Get testnet MON from the faucet for the deployer, and send about 0.3 MON to the agent address. Never paste a key that holds real funds anywhere.

### 2. Deploy the contracts

```bash
cd contracts
forge build && forge test                    # 50 passing
forge script script/Deploy.s.sol --rpc-url monad_testnet --account deployer --broadcast
```

The script deploys **Nadeye**, the **PasskeyRegistry** and the **NadeyeJournal**, and prints the three addresses. Nadeye is wired to Monad testnet's ERC-8004 registries: Identity `0x8004A818…D9e` and Reputation `0x8004B663…713`. The script refuses to deploy if they aren't there. Verify the sources with Monad's [Foundry verification guide](https://docs.monad.xyz/guides/verify-smart-contract/foundry) (chain id 10143).

### 3. Host the site

```bash
cd web && npm install
node build.mjs 0xNADEYE testnet 0xPASSKEYS 0xJOURNAL \
  [--drip=https://your-agent.example/drip] [--indexer=https://…/v1/graphql]
# writes web/dist/ (index.html, passkey.js, ethers.umd.min.js); both flags are optional
npx vercel deploy dist --prod                # or Netlify / GitHub Pages: upload the whole dist/ folder
```

Passkeys are bound to the domain, so pick the final domain before anyone signs in.

### 4. Build and load the extension

```bash
cd extension && npm install
NADEYE_TESTNET_CONTRACT=0xNADEYE NADEYE_SITE=https://your-site.vercel.app npm run build
```

The build bakes in the contract and trusts your site for the passkey hand-off, so nobody has to edit settings.

1. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `extension/`.
2. Download the model when the setup tab opens (about 45 MB, once).

To share the extension with judges, zip the built `extension/` folder (without `node_modules`) and attach it to a GitHub release.

### 5. Sign in with a passkey

On the site, open **My scanner**:

1. Choose **Create passkey**.
2. If the site has a drip URL, the agent sends the identity address gas MON on its own. Otherwise send it about 0.25 testnet MON from the faucet.
3. Choose **Create ERC-8004 agent** and enter your handle. This takes 4–5 transactions. The identity key registers the agent, your scanner key becomes its `agentWallet` with its own EIP-712 consent, and the scanner links it in Nadeye.
4. Choose **Prove with passkey** and answer two passkey prompts. Monad's P256 precompile verifies the proof, and your scanner gets the passkey chip on the leaderboard.
5. Choose **Use in extension**, then confirm the dialog the extension shows.
6. Optional: on **Registry**, check an image and choose **Unlock and save to my journal**. The entry shows up under **Private journal** on My scanner, on any device you sign in from.

**Optional: gas for new accounts.** Run the agent with `NADEYE_DRIP=1`, add your site's origin to `NADEYE_CORS_ORIGINS`, and pass the agent's public URL to `build.mjs` as `--drip=https://…/drip`. Each new address gets `NADEYE_DRIP_AMOUNT` (0.25 MON; agent setup plus the scanner top-up use about 0.16) once. There are per-IP and daily caps, and the agent wallet keeps its floor. The drip refuses to run on mainnet.

**Monad's reserve balance.** An account holding less than 10 MON can move value only in its first transaction within 3 blocks. Otherwise the transfer reverts and still pays gas. Nadeye's two value transfers (the drip, and the identity key's gas top-up for the scanner key) both handle this:
- **Before sending,** they wait until the sender has sent nothing in the last 3 blocks. That is about a second on Monad.
- **After sending,** they check the receipt, so a reverted transfer is reported and never counted as paid.

The same applies when you fund the agent wallet from your deployer: send one transfer at a time.

In the extension popup, turn on **Contribute verdicts** and browse.

### 6. Run the verifier agent

```bash
cd agent
npm install                                   # macOS arm64 binaries for onnxruntime + sharp
# on Linux x64 without CUDA: ONNXRUNTIME_NODE_INSTALL=skip npm install  (the CPU build is bundled)
cp .env.example .env                          # set NADEYE_CONTRACT and AGENT_PRIVATE_KEY (network: testnet)
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
      "env": { "NADEYE_NETWORK": "testnet", "NADEYE_CONTRACT": "0xNADEYE" }
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

**Optional public endpoint.** Run `cloudflared tunnel --url http://127.0.0.1:8787`, then re-run `register --public-url https://…`. That puts the MCP and HTTP endpoints into the agent's ERC-8004 registration file, and the server accepts the tunnel's host name automatically.

### 7. Deploy the indexer to Envio Cloud

The indexer feeds the site's **Activity** tab. Without it the site still works and reads the contracts directly, but there's no history.

1. **Get a token.** Create a free HyperSync token at [envio.dev/app/api-tokens](https://envio.dev/app/api-tokens).
2. **Check it locally (optional).** Run `cd indexer && npm install && npm test`, then `cp .env.example .env`, fill it in, and run `npm run dev`. That needs Docker and serves GraphQL at `http://localhost:8080/v1/graphql`.
3. **Connect the repo.** In [Envio Cloud](https://envio.dev/app), sign in with GitHub, add an indexer from your public `nadeye` repository, and set the root directory to `indexer/`. The CLI does the same: `npx envio-cloud indexer add --name nadeye --repo safwaanDK/nadeye`, then `indexer settings set` to set the root directory.
4. **Set the variables.** `ENVIO_NADEYE_ADDRESS` and `ENVIO_PASSKEYS_ADDRESS` are required. `ENVIO_START_BLOCK` (the deploy block) speeds up the first sync. `ENVIO_VERIFIER_ADDRESS` (your agent's wallet) restricts the answers to your verifier.
5. **Deploy and copy the endpoint.** Once it has synced, copy the GraphQL endpoint (`envio-cloud deployment endpoint …`). Rebuild the site with `--indexer=<endpoint>` and redeploy `dist/`.

### 8. List Nadeye in Monad's protocol registry (optional)

Fill in the addresses and site URL in `ecosystem/monad-protocols/nadeye.jsonc`, then open a pull request to [monad-crypto/protocols](https://github.com/monad-crypto/protocols) under `testnet/` (or `mainnet/` once it's on mainnet). The steps are in `ecosystem/monad-protocols/README.md`.

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
- `m/44'/60'/0'/0/0`: the **identity key**. It lives only in page memory, inside Mera signing sessions that are ended after every action.
- `m/44'/60'/0'/0/1`: the **scanner key**. It is handed to the extension through a content-script bridge that only trusted origins can use, and the user confirms each time.

The same passkey re-derives the same accounts on any device. The recovery phrase is available from the page in case the domain ever changes.

**The session.** These keys sign without a prompt, so the page limits them:
- **Scope.** They only sign transactions to Nadeye's three contracts, the ERC-8004 Identity Registry, or your own scanner key (gas top-ups). Anything else is refused before signing.
- **Lifetime.** They live only in this tab's memory and are wiped after 10 minutes without input, after an hour at most, or on **Lock now**. My scanner shows when the session ends.

### Private journal (Mera PRF, not an account)

The journal uses the same passkey for encryption, not for an account:
1. **A separate PRF salt.** The passkey's PRF is evaluated under its own salt, `sha256("nadeye:journal:v1")`. Mera's account keys use a different one.
2. **Two values from one output.** HKDF-SHA256 turns that output into an AES-256-GCM key and an opaque journal id. Neither is related to the account keys.
3. **Encrypted before it leaves.** Each entry (image hash, registry verdict, counts, your note, time) is encrypted in the browser, with the journal id as associated data. The scanner key appends it to `NadeyeJournal`.
4. **Readable from any device.** On a new device the passkey re-derives the id and key and decrypts every entry. Nothing secret is stored anywhere.

**What's public:** the scanner address that writes a journal, how many entries it has, and when they were written. **What's private:** what each entry says.

The first address to write a journal id becomes its only writer, so nobody can add entries to yours. Entries are at most 512 bytes, and notes are cut to fit by whole characters.

### Passkey proof (P256 precompile)

`PasskeyRegistry` turns the same passkey into an onchain fact.

**Registering.** WebAuthn only reveals a passkey's public key when the passkey is created, so **Prove with passkey** takes two prompts:
1. The first signature narrows the P256 key to two candidates.
2. The second signs `registrationChallenge(scanner)` and picks the right one.

The scanner key then calls `register(x, y, assertion)`. The contract checks:
- the user-presence and user-verification flags;
- that `clientDataJSON` is a `webauthn.get` carrying exactly that challenge;
- the signature over `sha256(authenticatorData ‖ sha256(clientDataJSON))`, through the precompile at `0x100`, with high-s signatures rejected.

**What a registration guarantees.** The challenge includes the chain, the registry, the account and a nonce, so a proof can't be replayed for another account or after a reset. One passkey can back only one account. That is friction against sybils, not proof of personhood.

**Cost.** A verify costs about 35k gas on the precompile, against about 283k in Solidity.

**For other apps.** `verifyFor(account, challenge, assertion)` lets any contract require that account's passkey to approve an action. See [docs/INTEGRATE.md](docs/INTEGRATE.md#4-passkey-approval).

### History and analytics (Envio HyperIndex)

The contract keeps totals, not history. `indexer/` replays Nadeye's events on Monad testnet through HyperSync and builds:
- **Image:** reports, AI votes, score sum, majority verdict, and first and last seen. Every verdict and verifier answer that touched it is reachable from here.
- **Scanner:** points, scans, firsts, signal and noise, handle, linked ERC-8004 agent, and whether it proved a passkey. That joins two contracts in one record.
- **Attestation:** one row per verdict, with the time, consensus judgement and points: the history the contract never stores.
- **VerifierAnswer:** the ERC-8004 Validation Registry is shared by every validator on Monad, so the indexer keeps only answers tagged `nadeye/ai-image`, optionally from one wallet. It also decodes the agent's `data:` JSON report, so each answer links to the image it judged.
- **DailyStat and Totals:** aggregates per UTC day and overall, including passkey holders and verifier answers. Neither is cheap to compute from the contracts.

**What the site does with it:** the **Activity** tab shows a 14-day chart and a live stream of verdicts. Each verdict carries the scanner's agent and passkey chips, and clicking one opens that image's community result. The tab also lists the verifier agent's answers, and it refreshes every 15 seconds.

**How it's checked:**
- **Unit tests** run the handlers on simulated events.
- **A parity test** runs the real `Nadeye.sol` on anvil with several scanners over three UTC days. It feeds the actual logs through the handlers and requires every image and scanner to equal the contract's own `getImage` and `getScanner`.
- **A runtime check** runs `envio start` against anvil over RPC (`config.local.yaml`) and confirms the Postgres tables match the chain.

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

The contract passed a stateful invariant fuzz campaign: 6 invariants, each held across 30,720 random calls, including against a hostile ERC-8004 registry. The campaign found and fixed one Medium issue: a gas-burning reputation registry could block attestations. The live ERC-8004 registries on Monad mainnet were audited too. They match the source Nadeye is tested against, and REA confirms the function selectors from bytecode. Nadeye's feedback call fits its 300k gas stipend at Monad prices, with a worst case of 264k. A single key can upgrade all three registries, and Nadeye contains the damage if one is upgraded.

A final pass hardened everything else that handles untrusted input:
- **URL fetcher:** the agent's fetcher checks the address it actually connects to, so DNS rebinding can't reach your network.
- **Local API:** the agent's HTTP API refuses unknown `Host` headers and unlisted browser origins.
- **Validator spending:** answers are capped per requesting agent, and pause when the wallet runs low.
- **Site scripts:** the site serves ethers itself instead of loading it from a CDN.
- **Image decoding:** sharp is upgraded past its image-decoder CVEs.
- **Deeper fuzzing:** a heavier invariant campaign (about 205,000 calls per invariant) passes.

See [SECURITY.md](SECURITY.md).

## Privacy and safety

- Images never leave the device in the extension. The agent fetches images only when asked to.
- The agent refuses URLs that resolve to private, loopback or link-local addresses, follows at most 3 redirects, caps size at 25 MB and time at 15 s, and binds to 127.0.0.1 by default.
- Contributing verdicts is off by default. When it's on, the hash, score, model byte, scanner address and time are public and permanent.

## Known limits

- **Sybil resistance.** The daily cap and consensus scoring raise the cost of farming points, but they don't stop it. ERC-8004 reputation lets readers choose which scanners to trust; stake-weighted consensus is the next step.
- **Signal-to-noise** judges each verdict against the majority at the time it was recorded. It is not recomputed later.
- **pHash** doesn't survive heavy crops, rotation or mirroring.
- **Mera's PRF requirement.** Desktop Chrome supports it only for passkeys saved in Google Password Manager.
- **Journal metadata.** The journal hides what you saved, not that you saved something. Its writer is your scanner address, so the entry count and timing are linked to your public scanner.
- **Upstream test.** One Sieve unit test (C2PA URI in head) also fails on Sieve's own `main`. Nadeye doesn't modify `forensics.js`.

## Tests

```bash
cd contracts && forge test     # 50 incl. 6 invariants (30,720 calls each; FOUNDRY_PROFILE=deep for ~205,000) + hostile-registry tests; points, quorum, ties, cap, batching, paging, fuzz, ERC-8004 link/feedback/rotation; passkey proofs (replay, UV, challenge, high-s, one key per account); journal writer lock, size limits, paging
cd extension && npm test       # pHash robustness, chain e2e on anvil, real service worker under mocked chrome incl. bridge origin checks
cd agent && npm test           # register -> validationRequest -> validator answers onchain -> attest -> HTTP + MCP; SSRF + DNS-rebinding guard, Host/Origin allow-lists, validator spend limits; drip caps, once-per-address across restarts, serialized sends, mainnet refusal
cd web && npm test             # passkey derivation + Mera sessions -> ERC-8004 agent with agentWallet -> linked scanner + WebAuthn proof registered on the P256 precompile (anvil, osaka); signing scope blocks other destinations; journal encrypt -> Monad -> fresh-device decrypt
cd web && npm run e2e          # real Chromium + virtual passkey (PRF): Activity tab from the indexer -> create -> drip -> unlock journal -> save -> fresh device decrypts -> idle lock (npx playwright install chromium first)
cd indexer && npm test         # typecheck + handlers on simulated events + parity with the real contract (anvil): every image and scanner tally equals getImage / getScanner
cd sdk && npm test             # lookupImage finds a resized copy of an attested image; pHash parity with the extension
cd contracts && forge test --evm-version osaka   # the same contracts on the native P256 precompile
```

The chain tests run against anvil with the ERC-8004 reference registries deployed the same way as on Monad (proxy → MinimalUUPS → upgrade).

## License

MIT. See `LICENSE` (Nadeye) and `LICENSE.sieve` (Sieve).
