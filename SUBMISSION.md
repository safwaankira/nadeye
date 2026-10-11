# BuildAnything submission — PixelProof

Category: **Testnet** (switch to **Mainnet** once deployed there)

---

**Project name**
PixelProof

**Tagline**
Detect AI images in your browser. Share the verdict on Monad.

**Description**
PixelProof is a Chrome extension that flags AI-generated images as you browse, with every image analyzed on your own device by a WebGPU/WASM model. Nothing is uploaded.

When you opt in, each verdict is recorded on Monad as a 64-bit perceptual hash plus a confidence score. The image itself never touches the chain. Every PixelProof user reads the same onchain registry, so the next person who meets that image on any site, even resized or recompressed, sees how many scanners flagged it right on the image's badge.

Scanners earn points for coverage, for being first to record an image and for agreeing with the existing consensus. A public leaderboard ranks them by points, active days and signal-to-noise, read directly from the contract with no backend.

**How it works**
1. Local detection with Sieve's fine-tuned ViT-S/16 (ONNX Runtime Web, WebGPU with WASM fallback).
2. A 64-bit DCT perceptual hash of the pixels becomes the registry key.
3. Verdicts queue in the extension and go out as one `attestBatch` transaction of up to 100, signed by a burner key that lives in the extension.
4. Lookups query the exact hash plus its 36 likeliest bit-flip variants in one `eth_call`, so re-encoded copies still match (94% vs 59% exact-only in our tests).
5. The contract keeps per-image tallies and per-scanner points, active days and signal-to-noise, with paged views the leaderboard reads directly.

**Why Monad**
Attesting what you browse means a constant stream of tiny writes. That needs very low fees and fast confirmation. Writes for different images hit different storage slots, which fits Monad's parallel execution. Because Monad bills the gas limit, the client estimates each batch and pads it by only 15%.

**Built with**
Solidity + Foundry, viem (`monadTestnet` / `monad` chains), ONNX Runtime Web, Chrome MV3, ethers.js on the leaderboard page.

**Credits**
Detection model and extension base: Sieve by Sriram Kiron (@Phineas1500), MIT licensed, winner of poidh bounty #323. PixelProof adds the perceptual hashing, Monad contract, chain client, batching, community badges, points system and leaderboard.

**Links**
- Repo: https://github.com/safwaanDK/pixelproof
- Leaderboard: <your hosted web/dist URL>
- Contract (testnet): <address> on https://testnet.monadvision.com
- Demo video: <link>

---

## 60-second demo script

1. **0–10s** Open X or a news site with PixelProof loaded. Badges appear on images; one AI image is blurred with `AI 94%`.
2. **10–20s** Open the popup: Monad Testnet, Contribute on, wallet funded, queue filling. Click **Send**, then click the "Last batch" link to show the transaction on the explorer.
3. **20–35s** Open a second Chrome profile (a different scanner). Visit a page with a resized copy of the same image. The badge now reads `AI 91% · 👥 1/1`: the community verdict, found by perceptual hash.
4. **35–50s** Open the leaderboard: both scanners ranked, points, active days and SNR updating. Drop the image into **Registry → Check an image** to show the lookup works from any browser.
5. **50–60s** Close on the privacy line: the image never left either browser; only a 64-bit hash and a score are on Monad.

## Launch post (X)

> Built PixelProof for @buildanythingso 🟣
>
> A Chrome extension that spots AI-generated images on-device (no uploads), then records the verdict on @monad as a perceptual hash.
>
> See an image someone already checked? Its badge shows how many scanners flagged it. Scan, earn points, climb the board.
>
> Detection by Sieve (@sriramkiron's poidh-winning model). Repo + leaderboard ⬇️
