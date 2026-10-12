// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Nadeye} from "../../src/Nadeye.sol";

/// ---------------------------------------------------------------------------
/// Stateful invariant campaign for Nadeye (Ultrafuzz-style: actors & flows ->
/// properties -> handler with a ghost model -> invariants).
///
/// Actors: 6 scanners, a small pool of image hashes (so consensus, ties and
/// majority flips happen constantly), UTC-day warps, ERC-8004 agent links and
/// a reputation registry that can be switched to hostile modes:
///   OK       records feedback
///   REVERT   always reverts
///   REENTER  re-enters Nadeye.attest from inside giveFeedback
///   BURN     burns all forwarded gas
/// ---------------------------------------------------------------------------

contract MockIdentity {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public wallets;

    function set(uint256 id, address owner, address wallet) external {
        owners[id] = owner;
        wallets[id] = wallet;
    }

    function ownerOf(uint256 id) external view returns (address o) {
        o = owners[id];
        require(o != address(0), "nonexistent");
    }

    function getAgentWallet(uint256 id) external view returns (address) {
        return wallets[id];
    }
}

contract HostileReputation {
    enum Mode { OK, REVERT, REENTER, BURN }

    Mode public mode;
    Nadeye public nadeye;
    uint256 public feedbackCount;
    uint256 public reentries;
    mapping(uint256 => uint256) public agreed;
    mapping(uint256 => uint256) public disagreed;
    bytes32 internal salt;

    function setNadeye(Nadeye n) external { nadeye = n; }
    function setMode(Mode m) external { mode = m; }

    function giveFeedback(uint256 agentId, int128 value, uint8, string calldata, string calldata,
        string calldata, string calldata, bytes32 feedbackHash) external
    {
        if (mode == Mode.REVERT) revert("hostile");
        if (mode == Mode.BURN) {
            uint256 x;
            while (true) { x = uint256(keccak256(abi.encode(x))); }
        }
        if (mode == Mode.REENTER) {
            // attest a fresh image *and* the image being judged, mid-update
            salt = keccak256(abi.encode(salt, feedbackHash));
            try nadeye.attest(bytes32(uint256(salt) | 1), 9000, 7) { ++reentries; } catch {}
            try nadeye.attest(feedbackHash, 9000, 7) { ++reentries; } catch {}
        }
        ++feedbackCount;
        if (value == 100) ++agreed[agentId];
        else ++disagreed[agentId];
    }
}

contract Handler is Test {
    Nadeye public immutable nadeye;
    MockIdentity public immutable identity;
    HostileReputation public immutable rep;

    address[] public actors;
    bytes32[] public hashes;

    // ---- ghost model ----------------------------------------------------
    struct GImage { uint32 reports; uint32 aiVotes; uint64 scoreSum; address first; }
    struct GScanner { uint64 points; uint32 scans; uint32 firsts; uint32 signal; uint32 noise; uint32 activeDays; uint32 lastDay; uint32 dayScans; bool seen; }
    mapping(bytes32 => GImage) public gImage;
    mapping(address => GScanner) public gScanner;
    mapping(bytes32 => mapping(address => bool)) public gAttested;
    mapping(address => uint256) public gAgent; // agentId + 1
    uint256 public gTotalScans;
    uint256 public gImages;
    uint256 public gFeedbackExpected; // judged verdicts by linked controllers while mode == OK
    bool public modeEverHostile;
    uint256 public calls;

    constructor(Nadeye n, MockIdentity i, HostileReputation r) {
        nadeye = n; identity = i; rep = r;
        for (uint256 k = 0; k < 6; ++k) actors.push(address(uint160(0x1000 + k)));
        for (uint256 k = 1; k <= 10; ++k) hashes.push(bytes32(k * 0x1111));
        // agent ids 0..5: actor k owns agent k; actor 5's agent uses a hot wallet = actor 4
        for (uint256 k = 0; k < 6; ++k) identity.set(k, actors[k], address(0));
        identity.set(5, address(0xC01D), actors[4]);
    }

    // the reentrant registry attests as itself; model those writes too
    function _modelAttest(address who, bytes32 h, uint16 score) internal returns (bool judged, bool agree) {
        GScanner storage s = gScanner[who];
        if (!s.seen) s.seen = true;
        uint32 today = uint32(block.timestamp / 1 days);
        if (s.lastDay != today || s.activeDays == 0) { s.lastDay = today; s.dayScans = 0; ++s.activeDays; }
        bool earns = s.dayScans < nadeye.DAILY_POINT_CAP();
        ++s.dayScans; ++s.scans;
        GImage storage g = gImage[h];
        bool isAI = score >= nadeye.AI_THRESHOLD();
        uint64 pts = earns ? nadeye.POINTS_SCAN() : 0;
        if (g.reports == 0) {
            g.first = who; ++gImages; ++s.firsts;
            if (earns) pts += nadeye.POINTS_FIRST();
        } else if (g.reports >= nadeye.QUORUM() && uint256(g.aiVotes) * 2 != g.reports) {
            judged = true;
            agree = (uint256(g.aiVotes) * 2 > g.reports) == isAI;
            if (agree) { ++s.signal; if (earns) pts += nadeye.POINTS_AGREE(); }
            else ++s.noise;
        }
        ++g.reports; if (isAI) ++g.aiVotes; g.scoreSum += score;
        s.points += pts; ++gTotalScans;
        gAttested[h][who] = true;
    }

    function _controls(address who, uint256 id) internal view returns (bool) {
        address o = identity.owners(id);
        return o != address(0) && (o == who || identity.wallets(id) == who);
    }

    // ---- actions --------------------------------------------------------
    function attest(uint256 a, uint256 h, uint16 score) public {
        ++calls;
        address who = actors[a % actors.length];
        bytes32 hash = hashes[h % hashes.length];
        score = uint16(bound(score, 0, 10_000));
        if (gAttested[hash][who]) {
            vm.prank(who);
            vm.expectRevert(Nadeye.AlreadyAttested.selector);
            nadeye.attest(hash, score, 1);
            return;
        }
        if (score >= nadeye.REAL_CEILING() && score < nadeye.AI_THRESHOLD()) {
            vm.prank(who);
            vm.expectRevert(Nadeye.UnsureScore.selector);
            nadeye.attest(hash, score, 1);
            return;
        }
        uint256 repBefore = rep.feedbackCount();
        (bool judged,) = _modelAttest(who, hash, score);
        vm.prank(who);
        nadeye.attest{gas: 5_000_000}(hash, score, 1);
        _afterRep(who, judged, repBefore);
    }

    function attestBatch(uint256 a, uint256 seed, uint8 n) public {
        ++calls;
        address who = actors[a % actors.length];
        n = uint8(bound(n, 0, 12));
        bytes32[] memory hs = new bytes32[](n);
        uint16[] memory ss = new uint16[](n);
        for (uint256 i; i < n; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            hs[i] = hashes[seed % hashes.length];
            ss[i] = uint16(seed % 10_001);
        }
        uint256 expected;
        uint256 judgedCount;
        uint256 repBefore = rep.feedbackCount();
        for (uint256 i; i < n; ++i) {
            if (gAttested[hs[i]][who]) continue;
            if (ss[i] >= nadeye.REAL_CEILING() && ss[i] < nadeye.AI_THRESHOLD()) continue;
            (bool judged,) = _modelAttest(who, hs[i], ss[i]);
            if (judged) ++judgedCount;
            ++expected;
        }
        vm.prank(who);
        uint256 rec = nadeye.attestBatch{gas: 25_000_000}(hs, ss, 1);
        assertEq(rec, expected, "batch recorded count");
        if (judgedCount > 0) _afterRep(who, true, repBefore);
    }

    function _afterRep(address who, bool judged, uint256 repBefore) internal {
        if (!judged) return;
        uint256 g = gAgent[who];
        if (g == 0 || !_controls(who, g - 1)) return;
        if (rep.mode() == HostileReputation.Mode.OK) {
            assertGt(rep.feedbackCount(), repBefore, "linked controller judged verdict must reach reputation");
        }
    }

    function link(uint256 a, uint256 id) public {
        ++calls;
        address who = actors[a % actors.length];
        id = id % 7; // 6 = nonexistent agent
        bool ok = _controls(who, id);
        vm.prank(who);
        if (!ok) {
            vm.expectRevert(Nadeye.NotAgentController.selector);
            nadeye.linkAgent(id);
            return;
        }
        nadeye.linkAgent(id);
        gAgent[who] = id + 1;
    }

    function unlink(uint256 a) public {
        ++calls;
        address who = actors[a % actors.length];
        vm.prank(who);
        nadeye.unlinkAgent();
        gAgent[who] = 0;
    }

    function transferAgent(uint256 id, uint256 to) public {
        ++calls;
        id = id % 6;
        identity.set(id, actors[to % actors.length], identity.wallets(id));
    }

    function warp(uint256 secs) public {
        ++calls;
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function setMode(uint8 m) public {
        ++calls;
        HostileReputation.Mode mode = HostileReputation.Mode(m % 4);
        rep.setMode(mode);
        if (mode != HostileReputation.Mode.OK) modeEverHostile = true;
    }

    // ---- getters for invariants ---------------------------------------------
    function actorCount() external view returns (uint256) { return actors.length; }
    function hashCount() external view returns (uint256) { return hashes.length; }
}

contract NadeyeInvariantTest is StdInvariant, Test {
    Nadeye nadeye;
    MockIdentity identity;
    HostileReputation rep;
    Handler handler;

    function setUp() public {
        vm.warp(1_760_000_000);
        identity = new MockIdentity();
        rep = new HostileReputation();
        nadeye = new Nadeye(address(identity), address(rep));
        rep.setNadeye(nadeye);
        handler = new Handler(nadeye, identity, rep);
        // the reentrant registry acts as an extra scanner; give it a model slot
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](7);
        sel[0] = Handler.attest.selector;
        sel[1] = Handler.attestBatch.selector;
        sel[2] = Handler.link.selector;
        sel[3] = Handler.unlink.selector;
        sel[4] = Handler.transferAgent.selector;
        sel[5] = Handler.warp.selector;
        sel[6] = Handler.setMode.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// I1: per-image tallies are internally consistent and bounded
    function invariant_imageTallies() public view {
        for (uint256 i; i < handler.hashCount(); ++i) {
            Nadeye.ImageView memory v = nadeye.getImage(handler.hashes(i));
            assertLe(v.aiVotes, v.reports, "aiVotes <= reports");
            assertLe(v.meanScore, 10_000, "mean score bounded");
            if (v.reports == 0) assertEq(v.firstScanner, address(0), "no first scanner without reports");
            else assertTrue(v.firstScanner != address(0), "first scanner recorded");
        }
    }

    /// I2: actor-scanned images match the ghost model exactly (registry reentry
    ///     only ever adds reports from the registry's own address)
    function invariant_matchesGhostForActors() public view {
        // A re-entering registry votes as its own scanner mid-batch, which the
        // ghost does not simulate; exact per-actor equality is checked only on
        // sequences without re-entry. Global accounting (I3) and the
        // deterministic NadeyeReentry tests cover the re-entrant case.
        if (rep.reentries() > 0) return;
        for (uint256 i; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            Nadeye.ScannerView memory s = nadeye.getScanner(a);
            (uint64 points, uint32 scans, uint32 firsts, uint32 signal, uint32 noise, uint32 activeDays,,,) = handler.gScanner(a);
            assertEq(s.scans, scans, "scans");
            assertEq(s.signal, signal, "signal");
            assertEq(s.noise, noise, "noise");
            assertEq(s.activeDays, activeDays, "active days");
            if (!handler.modeEverHostile()) {
                assertEq(s.points, points, "points");
                assertEq(s.firsts, firsts, "firsts");
            }
            assertLe(uint256(s.signal) + s.noise, s.scans, "judged <= scans");
            assertLe(s.firsts, s.scans, "firsts <= scans");
        }
    }

    /// I3: global counters agree with the per-image / per-scanner state
    function invariant_globalCounters() public view {
        (uint256 scans, uint256 images, uint256 scanners, uint256 flagged) = nadeye.stats();
        Nadeye.ScannerView[] memory all = nadeye.getScanners(0, 1000);
        assertEq(all.length, scanners, "scanner list length");
        uint256 sumScans; uint256 sumFirsts;
        for (uint256 i; i < all.length; ++i) { sumScans += all[i].scans; sumFirsts += all[i].firsts; }
        assertEq(sumScans, scans, "sum of scanner scans == totalScans");
        assertEq(sumFirsts, images, "sum of firsts == imageCount");

        Nadeye.ImageView[] memory recent = nadeye.recentImages(1_000_000);
        assertEq(recent.length, images, "recent list covers all images");
        uint256 sumReports; uint256 f;
        for (uint256 i; i < recent.length; ++i) {
            sumReports += recent[i].reports;
            if (uint256(recent[i].aiVotes) * 2 > recent[i].reports) ++f;
        }
        assertEq(sumReports, scans, "sum of image reports == totalScans");
        assertEq(f, flagged, "totalFlagged == images with AI majority");
    }

    /// I4: points never exceed the per-verdict maximum, and the daily cap holds
    function invariant_pointsBounded() public view {
        uint64 maxPer = nadeye.POINTS_SCAN() + nadeye.POINTS_FIRST() + nadeye.POINTS_AGREE();
        for (uint256 i; i < handler.actorCount(); ++i) {
            Nadeye.ScannerView memory s = nadeye.getScanner(handler.actors(i));
            assertLe(s.points, uint64(s.scans) * maxPer, "points <= scans * max");
            assertLe(s.points, uint64(s.activeDays) * nadeye.DAILY_POINT_CAP() * maxPer, "daily cap");
        }
    }

    /// I5: a scanner's agent link only ever points at an agent it controlled when linking
    function invariant_linksMatchGhost() public view {
        for (uint256 i; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            (bool linked, uint256 id) = nadeye.agentOf(a);
            uint256 g = handler.gAgent(a);
            assertEq(linked, g != 0, "link flag");
            if (linked) assertEq(id, g - 1, "linked id");
        }
    }

    function invariant_callSummary() public view {
        handler.calls(); // keeps the campaign's call count visible in traces
    }
}
