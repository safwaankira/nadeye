# Nadeye security review

Scope: `contracts/src/Nadeye.sol` (verdict registry, points, ERC-8004 linking and reputation feedback).
Method: the Ultrafuzz approach, run directly in Foundry. It has four steps:
1. Map actors and flows.
2. Enumerate properties.
3. Run a stateful invariant campaign with a ghost model and hostile dependencies.
4. Run a static scan with Slither 0.11.5.

## Findings

### F1 (Medium): A heavy or hostile reputation registry could block attestations (fixed)

**Problem.** `_attest` forwarded all remaining gas to `ReputationRegistry.giveFeedback`. The ERC-8004 registry is an upgradeable proxy that Nadeye doesn't control. If an implementation burns gas, the call consumes 63/64 of what's left. The catch path then runs out, and the whole attestation reverts. A batch fails on its second judged verdict. The result: every scanner with a linked agent loses the ability to attest.

**How it was found.** The invariant campaign flagged it. Every failing sequence ended with the gas-burning registry mode followed by `attest` or `attestBatch`.

**Fix.** Feedback calls now forward at most `REPUTATION_GAS = 300_000`. The reference registry uses 72k–174k gas at Ethereum prices and at most 264k at Monad prices (see D2).

**Tests.** `test_gasBurningRegistryCannotBlockAttest` and `test_gasBurningRegistryCannotBlockBatch` fail on the old code and pass on the fixed code.

### F2 (Informational): External call made before state was final (hardened)

**Problem.** The reputation call ran in the middle of `_attest`, before the image tallies and points were updated.

**Testing.** A re-entering registry kept the books consistent even before the change: `test_reentrantRegistryKeepsBooksConsistent` passes on both versions.

**Change.** The call now happens last (checks-effects-interactions), so any re-entry sees finished state.

### Accepted / by design
- **Onchain vote bands.** `AI_THRESHOLD = 8000` and `REAL_CEILING = 5000`. Scores in between are rejected (`UnsureScore`) by `attest` and skipped by `attestBatch`, and the handler's ghost model mirrors both. This keeps public AI votes to the band where Sieve's benchmark error is about 1–2%, not 10–12%. The badge's 65% local threshold is unchanged.
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

### D1 (Pass): Interface compatibility

- **Source matches the deployment.** The last change to any registry contract upstream was on 2026-01-24 (`27caef9`). All three proxies were created and upgraded on 2026-02-03, and the registries report version 2.0.0. The vendored copies in `contracts/test/erc8004/` are byte-identical to upstream at that point, so the 31 earlier tests ran against the deployed source.
- **giveFeedback.** Nadeye calls `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)`, selector `0x3c036a7e`. REA recovers that selector from the compiled implementation as nonpayable, with matching leading arguments.
- **Identity registry.** REA finds all five selectors Nadeye uses: `ownerOf` and `getAgentWallet` from the contract, and `register`, `setAgentURI` and `setAgentWallet` from the agent. The reputation registry's `getSummary` (`0x81bbba58`) is found as a view.

### D2 (Pass): `REPUTATION_GAS` covers Monad pricing

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

### D3 (Medium, accepted, external): A single key can upgrade all three registries

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

Batch return values and "linked controller's judged verdict reaches the registry" are asserted inline on every call. "Judged" is read from the contract's own `Attested` events, not the ghost model (see T1).

Run: `cd contracts && forge test` (34 tests). Settings are in `foundry.toml`. The final pass also ran the deep campaign, `FOUNDRY_PROFILE=deep forge test`: 1,024 runs × 200 calls, about 205,000 calls per invariant, all passing.

## Final pass (2026-10-12): agent, site and dependencies

Scope: everything that changed since the contract review (vote bands, site states, sort menu), plus the parts that handle untrusted input: the agent's HTTP API and URL fetcher, the site's rendering of chain data, and every dependency.

### A1 (Medium): The agent's URL fetcher could be steered into the operator's network (fixed)

**Problem.** `safefetch` checked a hostname's DNS answer and then let `fetch` resolve it again. A hostile DNS server can answer with a public address for the check and a private one for the connection (DNS rebinding), and reach the home router or local services. The private-range list also missed hex-written IPv4-mapped IPv6 (`::ffff:7f00:1`), IPv4-compatible IPv6, NAT64 (`64:ff9b::/96`), 6to4, site-local and several reserved IPv4 blocks.

**Fix.** Fetches go through undici with a connect-time `lookup` that refuses private answers, so the address checked is the address dialled. The ranges are a `net.BlockList` covering all of the above, with embedded IPv4 extracted from mapped and compatible IPv6.

**Tests.** `safefetch.test.mjs`. One test checks every listed form. Another starts a server on 127.0.0.1 and fetches `localhost` with the precheck skipped (the rebinding case), proving the connection itself refuses. The same server is reachable with the test-only escape hatch, so the refusal is the guard's.

### A2 (Medium): Any web page could drive the local agent (fixed)

**Problem.** The HTTP API answered every origin with `access-control-allow-origin: *` and accepted any `Host`. A page open in the operator's browser could use the agent as a fetch proxy, and combined with A1 reach their network. DNS rebinding against the server itself needed no CORS at all.

**Fix.**
- Requests must carry a known `Host`: loopback, the configured host, the tunnel's host from `--public-url`, or `NADEYE_ALLOWED_HOSTS`. Anything else gets 421.
- Browser requests with an `Origin` not in `NADEYE_CORS_ORIGINS` get 403 on `/verify` and `/mcp`. Agents calling server-to-server send no `Origin` and are unaffected.
- Allowed origins are echoed back, never `*`. Only `/health` and the agent card stay public.

**Tests.** `server.test.mjs` covers each case.

### A3 (Low): Validation requests could drain the validator's wallet (fixed)

**Problem.** Anyone can address ERC-8004 validation requests to the verifier, and each answer costs it gas. A spammer pays roughly as much as the verifier does, but a low-balance wallet could still be emptied.

**Fix.**
- `NADEYE_VALIDATOR_MAX_PER_HOUR` (default 30) caps answers per requesting agent per hour; excess requests are skipped and logged.
- Below `NADEYE_VALIDATOR_MIN_BALANCE` (default 0.05 MON), requests are deferred, not dropped, and answered after a top-up.

**Tests.** `validator-limits.test.mjs`.

### W1 (Low): The site ran a script from a CDN without an integrity check (fixed)

The leaderboard loaded ethers from cdnjs on a page that also derives passkey keys, so a tampered CDN file would have run there. ethers is now a pinned dev dependency (6.17.0), copied into `dist/` by the build and served from the site's own origin.

### D4 (High in a dependency): sharp's bundled image decoders (fixed)

sharp ≤ 0.35.5-rc.1 ships libvips, libheif and librsvg with published CVEs, and the agent decodes images fetched from arbitrary URLs with it. It is upgraded to 0.35.5 in the agent and the extension's dev tooling.

### T1 (test harness): A model-based assertion drifted after re-entry (fixed, no contract change)

The deep campaign failed "linked controller judged verdict must reach reputation". The shrunk sequence put the registry in re-entry mode, then later made a single attestation. The handler took "judged" from its ghost model, which is already known to drift after re-entry (I2 is limited for that reason). The assertion now reads "judged" from the contract's `Attested` events. It passes on the replayed sequence and across the full deep campaign, so the contract sent feedback every time it judged a linked controller's verdict.

### Checked, no change needed

| Area | Result |
| --- | --- |
| Slither 0.11.5 | The same 10 informational and low results as the first review; nothing new from the vote bands. |
| `npm audit` | Extension 0, site 0. The agent's two remaining items, adm-zip and sprintf-js, sit inside onnxruntime-node's install script, which unpacks Microsoft's own GPU packages at install time and never sees attacker input. Accepted. |
| Secrets | No keys, mnemonics or `.env` files in the tree or in git history. Only `agent/.env.example` with placeholders. `.env` is ignored at every level. |
| Site rendering of chain data | Every `innerHTML` template takes numbers, fixed strings or ABI-decoded addresses only. The free-text handle goes through `textContent`. Live-tested: a handle of `<img src=x onerror=alert(1)>` rendered as text, with no element and no dialog. |
| Extension | Badges use `textContent` and `setAttribute`. The CSP is `script-src 'self' 'wasm-unsafe-eval'`. There are no web-accessible resources. The passkey bridge only answers trusted origins and asks the user each time (tested). |
| MCP | Reading local files (`verify_image_file`) exists only on stdio, never on the HTTP endpoint. Tool inputs are validated with zod. |

### Site against a real chain

Nadeye was deployed to a local anvil on chain 143, and the page's Monad RPC calls were routed to it:

- **Loading:** a slow RPC shows "Reading the leaderboard from Monad…" first, never example rows.
- **Live:** it shows the real counts (6 verdicts, 3 scanners, 1 flagged), the feed shows both seeded images with the right verdicts, and there are no page errors.
- **Empty:** a fresh registry shows "No scanners yet" and "No images recorded yet".
- **RPC down:** it shows the error state with a working Try again button.

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
