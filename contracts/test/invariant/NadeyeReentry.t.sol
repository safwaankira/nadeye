// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Nadeye} from "../../src/Nadeye.sol";
import {MockIdentity, HostileReputation} from "./NadeyeInvariant.t.sol";

/// Deterministic checks for the hostile-registry findings.
contract NadeyeReentryTest is Test {
    Nadeye nadeye;
    MockIdentity identity;
    HostileReputation rep;
    address a = address(0xA1); address b = address(0xB2); address c = address(0xC3);
    bytes32 constant IMG = bytes32(uint256(0xabc));

    function setUp() public {
        vm.warp(1_760_000_000);
        identity = new MockIdentity();
        rep = new HostileReputation();
        nadeye = new Nadeye(address(identity), address(rep));
        rep.setNadeye(nadeye);
        identity.set(0, c, address(0));
        vm.prank(c); nadeye.linkAgent(0);
        vm.prank(a); nadeye.attest(IMG, 9000, 1);
        vm.prank(b); nadeye.attest(IMG, 8000, 1);
    }

    /// F1: a gas-burning registry must not make a linked scanner's attestation revert
    function test_gasBurningRegistryCannotBlockAttest() public {
        rep.setMode(HostileReputation.Mode.BURN);
        vm.prank(c);
        nadeye.attest{gas: 1_000_000}(IMG, 9500, 1); // judged -> calls the registry
        assertEq(nadeye.getScanner(c).signal, 1);
        assertEq(nadeye.getImage(IMG).reports, 3);
    }

    /// F1: same for a batch where every verdict is judged
    function test_gasBurningRegistryCannotBlockBatch() public {
        bytes32[] memory hs = new bytes32[](10);
        uint16[] memory ss = new uint16[](10);
        for (uint256 i; i < 10; ++i) {
            hs[i] = bytes32(uint256(0x100 + i));
            vm.prank(a); nadeye.attest(hs[i], 9000, 1);
            vm.prank(b); nadeye.attest(hs[i], 9000, 1);
            ss[i] = 9000;
        }
        rep.setMode(HostileReputation.Mode.BURN);
        vm.prank(c);
        uint256 rec = nadeye.attestBatch{gas: 8_000_000}(hs, ss, 1);
        assertEq(rec, 10);
        assertEq(nadeye.getScanner(c).signal, 10);
    }

    /// F2: a re-entering registry sees finished state and books stay consistent
    function test_reentrantRegistryKeepsBooksConsistent() public {
        rep.setMode(HostileReputation.Mode.REENTER);
        vm.prank(c);
        nadeye.attest{gas: 3_000_000}(IMG, 9500, 1);
        assertGt(rep.reentries(), 0, "reentry actually happened");
        (uint256 scans, uint256 images,, uint256 flagged) = nadeye.stats();
        Nadeye.ImageView[] memory all = nadeye.recentImages(100);
        uint256 sum; uint256 f;
        for (uint256 i; i < all.length; ++i) {
            sum += all[i].reports;
            if (uint256(all[i].aiVotes) * 2 > all[i].reports) ++f;
        }
        assertEq(all.length, images);
        assertEq(sum, scans);
        assertEq(f, flagged);
        // the judged verdict was recorded exactly once for c
        assertEq(nadeye.getScanner(c).scans, 1);
        assertEq(nadeye.getScanner(c).signal, 1);
    }

    /// a reverting registry is skipped, attestation stands
    function test_revertingRegistryIsSkipped() public {
        rep.setMode(HostileReputation.Mode.REVERT);
        vm.prank(c);
        nadeye.attest(IMG, 9500, 1);
        assertEq(nadeye.getScanner(c).signal, 1);
        assertEq(rep.feedbackCount(), 0);
    }
}
