# Nadeye security review

Scope: `contracts/src/Nadeye.sol` (verdict registry, points, ERC-8004 linking and reputation feedback).
Method: the Ultrafuzz approach, run directly in Foundry. It has four steps:
1. Map actors and flows.
2. Enumerate properties.
3. Run a stateful invariant campaign with a ghost model and hostile dependencies.
4. Run a static scan with Slither 0.11.5.

## Findings

### F1 — Medium — A heavy or hostile reputation registry could block attestations (fixed)

**Problem.** `_attest` forwarded all remaining gas to `ReputationRegistry.giveFeedback`. The ERC-8004 registry is an upgradeable proxy that Nadeye doesn't control. If an implementation burns gas, the call consumes 63/64 of what's left. The catch path then runs out, and the whole attestation reverts. A batch fails on its second judged verdict. The result: every scanner with a linked agent loses the ability to attest.

**How it was found.** The invariant campaign flagged it. Every failing sequence ended with the gas-burning registry mode followed by `attest` or `attestBatch`.

**Fix.** Feedback calls now forward at most `REPUTATION_GAS = 300_000`. The reference registry uses 72k–174k gas.

**Tests.** `test_gasBurningRegistryCannotBlockAttest` and `test_gasBurningRegistryCannotBlockBatch` fail on the old code and pass on the fixed code.

### F2 — Informational — External call made before state was final (hardened)

**Problem.** The reputation call ran in the middle of `_attest`, before the image tallies and points were updated.

**Testing.** A re-entering registry kept the books consistent even before the change: `test_reentrantRegistryKeepsBooksConsistent` passes on both versions.

**Change.** The call now happens last (checks-effects-interactions), so any re-entry sees finished state.

### Accepted / by design
- **Sybil voting.** Anyone can create addresses and vote, so a cluster can steer an image's majority and with it other scanners' agreement scores. The mitigations are the daily point cap and ERC-8004 reputation: readers choose which scanners' feedback to trust. Stake-weighted consensus is future work.
- **Signal-to-noise at write time.** Each verdict is judged against the majority at the moment it's recorded. It is not recomputed later.
- **Slither notes.** The remaining detectors (external calls in a batch loop, an event after the call, timestamp day-bucketing, gas costs) were triaged as non-issues.

## Invariants (all pass: 256 runs × 120 calls each, 30,720 calls per invariant)

The handler drives the contract with:
- 6 scanners and 10 shared image hashes, so ties and majority flips happen constantly;
- UTC-day warps;
- agent linking, unlinking and transfers of agent ownership;
- a reputation registry that cycles between **ok**, **revert**, **re-enter** and **burn gas**.

| Invariant | Property |
| --- | --- |
| I1 image tallies | `aiVotes ≤ reports`, mean score ≤ 10000, first scanner set if and only if reports > 0 |
| I2 ghost model | Per-scanner scans, signal, noise, active days, points and firsts equal an independent model (sequences without re-entry) |
| I3 global counters | Σ scanner scans = Σ image reports = `totalScans`; Σ firsts = image count; `totalFlagged` = images with an AI majority |
| I4 points bounded | Points ≤ scans × max-per-verdict, and ≤ active days × daily cap × max |
| I5 agent links | A link only exists for an agent the scanner controlled when linking |

Batch return values and "linked controller's judged verdict reaches the registry" are asserted inline on every call.

Run: `cd contracts && forge test` (31 tests). Settings are in `foundry.toml`.

## Full Ultrafuzz campaign (optional)

Ultrafuzz's AI agents run with permission checks off, which Claude Code refuses to do as root. Run it on a throwaway VM as a non-root user:

```bash
# Ubuntu 24.04 VM, as a non-root user with Node 22, Bun ≥1.3, Foundry, git
git clone https://github.com/monad-developers/ultrafuzz && cd ultrafuzz && git checkout v0.1.3
npx pnpm@11.1.1 install && npx pnpm@11.1.1 --filter "@ultrafuzz/cli..." build
npm i -g recon-generate@0.0.42 @anthropic-ai/claude-code
python3 -m venv ~/sec && ~/sec/bin/pip install slither-analyzer==0.11.5 \
  "covg-eval @ git+https://github.com/Recon-Fuzz/recon-magic-framework.git@f92ad26ff857526d221c3e8488c5aea2a20e8fdf#subdirectory=tools/covg_eval"
# plus the recon fuzzer v0.4.17 release binary on PATH, then: claude login
UF="node $(pwd)/packages/cli/dist/index.js"
cd /path/to/nadeye/contracts && $UF init --project .
# ultrafuzz.toml: audit_profile = "low-cost"; [models.default] agent = "ClaudeAgent"
$UF doctor --project . && $UF references sync --project .
$UF run --project . --audit-profile low-cost   # first run prints the data-governance route to acknowledge
```
