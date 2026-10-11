# PixelProof

**Detect AI-generated images in your browser. Share the verdict on Monad.**

PixelProof is a Chrome extension plus a Monad smart contract. The extension decides, on your own device, whether each image you scroll past was AI-generated. With your opt-in, it records that verdict on Monad as a 64-bit perceptual hash and a confidence score. The image itself never leaves your browser.

Everyone running PixelProof reads the same registry, so the next person to meet that image (on any site, even resized or recompressed) sees how many scanners flagged it. Scanners earn points for coverage, first finds and agreeing with the consensus, ranked on a public leaderboard that reads straight from the chain.

```
 browser (all local)                                   Monad
 ┌───────────────────────────────────────────┐        ┌──────────────────────────┐
 │ page image ─▶ ViT-S/16 on WebGPU/WASM ─▶ score ───┐ │ PixelProof.sol           │
 │           └─▶ 64-bit DCT pHash ─────────▶ key  ───┼▶│  attestBatch(keys, scores)│
 │                                                   │ │  getImages(keys) ◀─ badge │
 │ burner key in chrome.storage signs batches ───────┘ │  getScanners() ◀─ board   │
 └───────────────────────────────────────────┘        └──────────────────────────┘
```

## What's in the repo

| Path | What it is |
| --- | --- |
| `contracts/` | `PixelProof.sol` (Foundry): verdict registry, points, active days, signal-to-noise, paged leaderboard views. 14 tests incl. fuzz. |
| `extension/` | The Chrome extension (MV3). Detection is Sieve; PixelProof adds `phash.js`, `chain/` (viem client, burner wallet, batching), community badges, the Monad popup panel and wallet backup. |
| `web/` | Leaderboard + registry lookup site. One HTML file, no backend: it calls the contract over the public RPC. |

## Credits

The detection model and the extension it ships in are **[Sieve](https://github.com/Phineas1500/sieve-ai-image-detector)** by **Sriram Kiron (@sriramkiron, GitHub @Phineas1500)**, MIT licensed, the winning claim of the [poidh local-AI bounty #323](https://poidh.xyz/arbitrum/bounty/323) (91.3% balanced accuracy on clean images, 87.3% on web-degraded ones, at a 65% threshold). Sieve itself builds on [Community Forensics](https://github.com/JeongsooP/Community-Forensics) (Park & Owens, CVPR 2025, MIT) and ONNX Runtime Web (MIT).

New in PixelProof: the perceptual hashing and near-match lookup, the Monad contract, the chain client and burner wallet, batched attestations, community-verdict badges, the scanner points system and the leaderboard site. See `NOTICE`.

Model misclassifications should still be reported upstream to Sieve (the right-click "report misclassification" menu goes there).

## Quick start

Requirements: Node ≥ 20, Chrome ≥ 124, [Foundry](https://book.getfoundry.sh/getting-started/installation).

### 1. Deploy the contract to Monad testnet

```bash
cd contracts
forge build
forge test                                   # 14 passing
cast wallet import deployer --interactive    # paste a funded testnet key once
forge script script/Deploy.s.sol --rpc-url monad_testnet --account deployer --broadcast
```

Get testnet MON from the [BuildAnything faucet](https://buildanything.so/faucet). Note the printed address. To verify the source on the explorer, follow Monad's [Foundry verification guide](https://docs.monad.xyz/guides/verify-smart-contract/foundry) (chain id `10143`).

### 2. Build and load the extension

```bash
cd extension
# paste the address into src/chain/config.js -> NETWORKS.testnet.contract
npm install
npm run build        # vendors ONNX Runtime Web + bundles the chain client
npm test             # pHash, chain e2e and service-worker tests (need anvil on PATH)
```

Then open `chrome://extensions`, enable Developer mode, **Load unpacked** → select `extension/`. The setup tab opens. Press **Download model** (a one-time ~45 MB download of Sieve's pinned, checksummed weights).

Already built it without the address? Open the extension's **Options → Network override** and paste the contract there. No rebuild needed.

### 3. Turn on contributions

Click the PixelProof icon:

1. Switch on **Contribute verdicts**.
2. Click the scanner wallet address to copy it, then fund it from the faucet. A fraction of a MON lasts a long time.
3. Optionally save your X handle so you appear by name on the leaderboard.

Browse normally. Verdicts queue up and go out in batches of up to 100, every minute or as soon as 25 are waiting (**Send** forces it). Badges gain a `👥 3/4` suffix when other scanners have recorded the same image.

### 4. Host the leaderboard

```bash
node web/build.mjs 0xYourContract testnet    # writes web/dist/index.html
```

Deploy `web/dist/` to any static host (Vercel, Netlify, GitHub Pages). The page also accepts `?contract=0x…&network=testnet`. Put the hosted URL into `LEADERBOARD_URL` in `extension/src/chain/config.js` so the popup links to it.

### 5. Mainnet

Repeat step 1 with `--rpc-url monad_mainnet` (use a hardware wallet or keystore for the deployer, never a raw key), set `NETWORKS.mainnet.contract`, rebuild, and switch the popup's network selector. Fund the scanner wallet with real MON.

## How the registry works

**Key.** A 64-bit DCT perceptual hash: luma, area-averaged to 32×32, 2-D DCT, the 8×8 lowest frequencies, each bit = coefficient above the median. Stored as `bytes32`.

**Near matches.** Re-encoding flips a few hash bits, almost always the ones closest to the median. So a lookup asks the contract for the hash **plus every 1- and 2-bit flip among its 8 least-stable bits** (37 keys) in one `eth_call`, then merges the hits. On a test set of 30 images × 4 re-encodings (resize + JPEG q40–85, WebP q50), exact-hash matches found 59% of copies; the 37-key probe found 94%.

**Points** (constants in the contract):

| Event | Points |
| --- | --- |
| Verdict recorded | +10 |
| First scanner to record the image | +25 |
| Agree with the existing majority (image has ≥2 prior reports, no tie) | +15 |
| Disagree with the majority | 0, counted as noise |
| Point-earning verdicts per address per UTC day | 300 cap |

**Signal-to-noise** = agreed ÷ (agreed + disagreed). **Active days** = distinct UTC days with at least one verdict.

**Verdict.** A report is an "AI" vote when its score is ≥ 65% (Sieve's threshold, stored as basis points ≥ 6500). Degraded inputs (heavy recompression or upscaling), which Sieve shows as "unsure", are never attested.

## Why Monad

- Attesting what you browse means many small writes. That only works with very low fees and roughly one-second confirmation.
- Each image's record and each scanner's record are separate storage slots, so attestations from different people rarely touch the same state. That is the workload Monad's parallel execution is built for.
- Monad charges for the **gas limit** you set, not the gas used. The client estimates every batch and adds only a 15% buffer (`GAS_BUFFER`), instead of the usual 2× padding.
- Full EVM compatibility: standard Solidity, Foundry and viem, using viem's built-in `monad` / `monadTestnet` chain definitions.

Measured gas: about 110–140k per newly attested image inside a batch (higher for an address's first ever verdict, which creates its scanner record), ~35k for `setHandle`.

## Privacy

- Images are never uploaded. Detection runs locally, as in Sieve (see `extension/PRIVACY.sieve.md`).
- Contributing is **off by default**. When on, each verdict publishes a 64-bit hash, a score, a model-version byte, your scanner address and the time. That is public and permanent. A hash cannot be turned back into the picture, but anyone holding the same image can compute its hash and see that your address recorded it. The scanner wallet is a fresh burner key, not your main wallet, which limits linkage. Setting an X handle links the two on purpose.
- Community lookups send only hashes to the Monad RPC.

## Known limits

- Sybil resistance is basic: the daily cap and consensus scoring raise the cost of farming, but many burner wallets can still inflate points. A stake-weighted or attestation-gated mode (e.g. require a minimum MON balance or an NFT) is the natural next step.
- Signal-to-noise judges each verdict against the majority at the moment it was recorded. It is not recomputed when the consensus later shifts.
- Perceptual hashes don't survive heavy crops, rotations or mirroring.
- One upstream Sieve unit test (`detects C2PA trainedAlgorithmicMedia URI anywhere in head`) fails on Sieve's own `main` as well. PixelProof does not modify `forensics.js`.

## Tests

```bash
cd contracts && forge test                 # 14 tests: points, quorum, ties, daily cap, batching, paging, fuzz
cd extension && npm test                   # needs anvil on PATH and a prior forge build + npm run build
```

`extension/test/background.harness.test.mjs` loads the real service worker under a mocked `chrome` API against anvil running with Monad testnet's chain id, and checks analyze → queue → batch → lookup → stats end to end.

## License

MIT. See `LICENSE` (PixelProof) and `LICENSE.sieve` (Sieve, Copyright its authors).
