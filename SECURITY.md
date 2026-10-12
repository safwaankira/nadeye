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

**Fix.** Feedback calls now forward at most `REPUTATION_GAS = 300_000`. The reference registry uses 72k–174k gas at Ethereum prices and at most 264k at Monad prices (see D2).

**Tests.** `test_gasBurningRegistryCannotBlockAttest` and `test_gasBurningRegistryCannotBlockBatch` fail on the old code and pass on the fixed code.

### F2 — Informational — External call made before state was final (hardened)

**Problem.** The reputation call ran in the middle of `_attest`, before the image tallies and points were updated.

**Testing.** A re-entering registry kept the books consistent even before the change: `test_reentrantRegistryKeepsBooksConsistent` passes on both versions.

**Change.** The call now happens last (checks-effects-interactions), so any re-entry sees finished state.

### Accepted / by design
- **Sybil voting.** Anyone can create addresses and vote, so a cluster can steer an image's majority and with it other scanners' agreement scores. The mitigations are the daily point cap and ERC-8004 reputation: readers choose which scanners' feedback to trust. Stake-weighted consensus is future work.
- **Signal-to-noise at write time.** Each verdict is judged against the majority at the moment it's recorded. It is not recomputed later.
- **Slither notes.** The remaining detectors (external calls in a batch loop, an event after the call, timestamp day-bucketing, gas costs) were triaged as non-issues.

## Live dependency audit: ERC-8004 registries on Monad mainnet

Nadeye calls three registries it doesn't control: Identity `0x8004A169…a432`, Reputation `0x8004BAa1…9b63` and Validation `0x8004Cc84…AB58`. This audit checks that what's deployed is what Nadeye was built and tested against.

**Method.**
- Upstream git history: [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts).
- Monadscan, for proxy, upgrade and transaction records.
- [REA](https://github.com/morluto/rea) 6.4.0 `inspect-evm-interface`, which recovers selectors from bytecode offline.
- A Foundry gas measurement repriced to Monad's opcode schedule.

The sandbox can't reach a Monad RPC, so live bytecode was not hashed. D1 rests on source history, not a bytecode match.

### D1 — Pass — Interface compatibility

- **Source matches the deployment.** The last change to any registry contract upstream was on 2026-01-24 (`27caef9`). All three proxies were created and upgraded on 2026-02-03, and the registries report version 2.0.0. The vendored copies in `contracts/test/erc8004/` are byte-identical to upstream at that point, so the 31 earlier tests ran against the deployed source.
- **giveFeedback.** Nadeye calls `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)`, selector `0x3c036a7e`. REA recovers that selector from the compiled implementation as nonpayable, with matching leading arguments.
- **Identity registry.** REA finds all five selectors Nadeye uses: `ownerOf` and `getAgentWallet` from the contract, and `register`, `setAgentURI` and `setAgentWallet` from the agent. The reputation registry's `getSummary` (`0x81bbba58`) is found as a view.

### D2 — Pass — `REPUTATION_GAS` covers Monad pricing

**Concern.** Live giveFeedback transactions on Monadscan carry gas limits from about 181k to 391k, three of the latest 50 are above 300k, and one used 298,989. Monad bills the gas limit, so these figures mean each sender's limit. They include the 21k base transaction cost and the caller's own strings.

**Measurement.** `test/MonadGas.t.sol` makes Nadeye's exact call: the first-ever feedback for an agent, with every account and slot cold. It records every account and slot touched and reprices them at [Monad rates](https://docs.monad.xyz/developer-essentials/opcode-pricing): cold account 10,100; cold storage page 8,100; a new slot 27,900. It treats every slot as its own page, which can only overcount.

| Measure | Value |
| --- | --- |
| Gas at Ethereum prices | 157,420 |
| Accounts touched | 4 |
| Cold slot reads | 6 |
| New slots | 7 |
| **Monad upper bound** | **264,020** (stipend 300,000) |

Nadeye always sends the same two short tags and empty URIs, so its cost can't grow with input. The test fails if a future registry or pricing change pushes the bound past the stipend.

### D3 — Medium (accepted, external) — A single key can upgrade all three registries

All three are UUPS proxies. The only upgrades so far came from one EOA, `0x547289319C3e6aedB179C0b8e8aF0B5ACd062603`, on 2026-02-03. Upstream's upgrade script reads `OWNER_PRIVATE_KEY` from `.env`. Whoever holds that key can replace any registry's logic at any time.

**Effect on Nadeye.** Bounded:
- **Reputation.** Calls go out last, with a 300k cap, inside `try/catch`. A changed, reverting or gas-burning registry turns into `ReputationSkipped`, and attestations and points carry on. F1, F2 and invariants I1–I5 test this against reverting, re-entering and gas-burning registries.
- **Identity.** A malicious identity registry could change who `linkAgent` accepts as an agent's controller (I5 only holds for an honest registry). That link affects reputation labels and nothing else: verdicts, tallies and points don't read it.
- **What Nadeye can't prevent.** A changed registry can rewrite or drop the reputation history it stores.

**Watch.** Monitor `Upgraded(address)` events on the three proxies. If one fires, re-run D1 and D2 against the new implementation before trusting new feedback.

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

Run: `cd contracts && forge test` (32 tests). Settings are in `foundry.toml`.

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
