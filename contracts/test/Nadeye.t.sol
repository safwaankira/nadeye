// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Nadeye} from "../src/Nadeye.sol";

contract NadeyeTest is Test {
    Nadeye pp;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address dave = address(0xDA7E);
    bytes32 constant IMG = bytes32(uint256(0xdeadbeefcafef00d));
    bytes32 constant IMG2 = bytes32(uint256(0x1234));

    function setUp() public {
        vm.warp(1_760_000_000);
        pp = new Nadeye(address(0), address(0));
    }

    function test_firstScanEarnsScanPlusFirstBonus() public {
        vm.prank(alice);
        pp.attest(IMG, 9_000, 14);
        Nadeye.ScannerView memory a = pp.getScanner(alice);
        assertEq(a.points, 35);
        assertEq(a.scans, 1);
        assertEq(a.firsts, 1);
        assertEq(a.activeDays, 1);
        Nadeye.ImageView memory v = pp.getImage(IMG);
        assertEq(v.reports, 1);
        assertEq(v.aiVotes, 1);
        assertEq(v.meanScore, 9_000);
        assertEq(v.firstScanner, alice);
        (uint256 scans, uint256 images, uint256 scanners, uint256 flagged) = pp.stats();
        assertEq(scans, 1); assertEq(images, 1); assertEq(scanners, 1); assertEq(flagged, 1);
    }

    function test_duplicateReverts() public {
        vm.startPrank(alice);
        pp.attest(IMG, 9_000, 14);
        vm.expectRevert(Nadeye.AlreadyAttested.selector);
        pp.attest(IMG, 1_000, 14);
    }

    function test_unsureBandIsNotRecorded() public {
        // boundaries: < 5000 real, [5000, 8000) unsure, >= 8000 AI
        vm.startPrank(alice);
        vm.expectRevert(Nadeye.UnsureScore.selector);
        pp.attest(IMG, 5_000, 14);
        vm.expectRevert(Nadeye.UnsureScore.selector);
        pp.attest(IMG, 7_999, 14);
        vm.expectRevert(Nadeye.UnsureScore.selector);
        pp.attest(IMG, 6_500, 14); // flagged by the badge, still not an onchain vote
        pp.attest(IMG, 8_000, 14);
        pp.attest(IMG2, 4_999, 14);
        vm.stopPrank();
        Nadeye.ImageView memory a = pp.getImage(IMG);
        Nadeye.ImageView memory b = pp.getImage(IMG2);
        assertEq(a.aiVotes, 1);
        assertEq(b.reports, 1);
        assertEq(b.aiVotes, 0);
    }

    function test_batchSkipsUnsureScores() public {
        bytes32[] memory h = new bytes32[](4);
        uint16[] memory s = new uint16[](4);
        h[0] = IMG; s[0] = 9_000;
        h[1] = IMG2; s[1] = 7_000;              // unsure: skipped
        h[2] = bytes32(uint256(3)); s[2] = 1_000;
        h[3] = bytes32(uint256(4)); s[3] = 5_000; // unsure: skipped
        vm.prank(alice);
        assertEq(pp.attestBatch(h, s, 14), 2);
        assertFalse(pp.hasAttested(IMG2, alice));
        (uint256 scans,,,) = pp.stats();
        assertEq(scans, 2);
        // the skipped image can still be attested later with a confident score
        vm.prank(alice);
        pp.attest(IMG2, 8_800, 14);
    }

    function test_rejectsBadInput() public {
        vm.expectRevert(Nadeye.InvalidScore.selector);
        pp.attest(IMG, 10_001, 14);
        vm.expectRevert(Nadeye.EmptyHash.selector);
        pp.attest(bytes32(0), 5_000, 14);
    }

    function test_consensusJudgedOnlyAfterQuorum() public {
        vm.prank(alice); pp.attest(IMG, 9_000, 14);  // first
        vm.prank(bob);   pp.attest(IMG, 8_000, 14);  // 1 prior report: not judged
        Nadeye.ScannerView memory b = pp.getScanner(bob);
        assertEq(b.points, 10);
        assertEq(b.signal + b.noise, 0);

        vm.prank(carol); pp.attest(IMG, 8_500, 14);  // majority AI, agrees
        Nadeye.ScannerView memory c = pp.getScanner(carol);
        assertEq(c.signal, 1);
        assertEq(c.points, 25);

        vm.prank(dave); pp.attest(IMG, 1_000, 14);   // disagrees
        Nadeye.ScannerView memory d = pp.getScanner(dave);
        assertEq(d.noise, 1);
        assertEq(d.points, 10);

        Nadeye.ImageView memory v = pp.getImage(IMG);
        assertEq(v.reports, 4);
        assertEq(v.aiVotes, 3);
        assertEq(v.meanScore, (9_000 + 8_000 + 8_500 + 1_000) / 4);
    }

    function test_tieIsNotJudged() public {
        vm.prank(alice); pp.attest(IMG, 9_000, 14);
        vm.prank(bob);   pp.attest(IMG, 1_000, 14);
        vm.prank(carol); pp.attest(IMG, 9_000, 14); // 1 AI vs 1 real before her
        Nadeye.ScannerView memory c = pp.getScanner(carol);
        assertEq(c.signal + c.noise, 0);
    }

    function test_flaggedCountTracksMajority() public {
        vm.prank(alice); pp.attest(IMG, 9_000, 14);
        (,,, uint256 f1) = pp.stats();
        assertEq(f1, 1);
        vm.prank(bob); pp.attest(IMG, 1_000, 14);    // 1-1 tie: no majority
        (,,, uint256 f2) = pp.stats();
        assertEq(f2, 0);
        vm.prank(carol); pp.attest(IMG, 8_000, 14);  // back to AI
        (,,, uint256 f3) = pp.stats();
        assertEq(f3, 1);
    }

    function test_activeDaysCountDistinctDays() public {
        vm.startPrank(alice);
        pp.attest(IMG, 9_000, 14);
        pp.attest(IMG2, 9_000, 14);
        assertEq(pp.getScanner(alice).activeDays, 1);
        vm.warp(block.timestamp + 1 days);
        pp.attest(bytes32(uint256(3)), 9_000, 14);
        assertEq(pp.getScanner(alice).activeDays, 2);
    }

    function test_batchSkipsDuplicates() public {
        bytes32[] memory h = new bytes32[](3);
        uint16[] memory s = new uint16[](3);
        h[0] = IMG; h[1] = IMG2; h[2] = IMG;
        s[0] = 9_000; s[1] = 2_000; s[2] = 9_000;
        vm.prank(alice);
        uint256 rec = pp.attestBatch(h, s, 14);
        assertEq(rec, 2);
        assertEq(pp.getScanner(alice).scans, 2);
        assertEq(pp.imageCount(), 2);
    }

    function test_batchLengthAndSize() public {
        vm.expectRevert(Nadeye.LengthMismatch.selector);
        pp.attestBatch(new bytes32[](2), new uint16[](1), 14);
        vm.expectRevert(Nadeye.BatchTooLarge.selector);
        pp.attestBatch(new bytes32[](101), new uint16[](101), 14);
    }

    function test_dailyPointCap() public {
        uint256 cap = pp.DAILY_POINT_CAP();
        vm.startPrank(alice);
        for (uint256 i = 1; i <= cap + 5; ++i) pp.attest(bytes32(i), 2_000, 14);
        Nadeye.ScannerView memory a = pp.getScanner(alice);
        assertEq(a.scans, cap + 5);
        assertEq(a.points, uint64(cap) * 35); // the 5 extra scans earn nothing
        vm.warp(block.timestamp + 1 days);
        pp.attest(bytes32(uint256(99_999)), 2_000, 14);
        assertEq(pp.getScanner(alice).points, uint64(cap) * 35 + 35); // cap resets
    }

    function test_handleAndPaging() public {
        vm.prank(alice); pp.attest(IMG, 9_000, 14);
        vm.prank(bob); pp.attest(IMG2, 9_000, 14);
        vm.prank(alice); pp.setHandle("safwaan_uddin");
        Nadeye.ScannerView[] memory page = pp.getScanners(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0].handle, "safwaan_uddin");
        assertEq(pp.getScanners(1, 10).length, 1);
        assertEq(pp.getScanners(5, 10).length, 0);
        vm.expectRevert(Nadeye.HandleTooLong.selector);
        pp.setHandle("this-handle-is-way-too-long-for-the-board");
    }

    function test_recentImagesNewestFirst() public {
        vm.prank(alice); pp.attest(IMG, 9_000, 14);
        vm.prank(alice); pp.attest(IMG2, 1_000, 14);
        Nadeye.ImageView[] memory r = pp.recentImages(5);
        assertEq(r.length, 2);
        assertEq(r[0].pHash, IMG2);
        assertEq(r[1].pHash, IMG);
    }

    function test_batchLookup() public {
        vm.prank(alice); pp.attest(IMG, 9_000, 14);
        bytes32[] memory q = new bytes32[](2);
        q[0] = IMG; q[1] = IMG2;
        Nadeye.ImageView[] memory r = pp.getImages(q);
        assertEq(r[0].reports, 1);
        assertEq(r[1].reports, 0);
    }

    function testFuzz_meanStaysInRange(uint16 a, uint16 b) public {
        // recordable scores only: [0, 5000) and [8000, 10000]
        a = uint16(bound(a, 0, 7_000)); if (a >= 5_000) a += 3_000;
        b = uint16(bound(b, 0, 7_000)); if (b >= 5_000) b += 3_000;
        vm.prank(alice); pp.attest(IMG, a, 14);
        vm.prank(bob); pp.attest(IMG, b, 14);
        Nadeye.ImageView memory v = pp.getImage(IMG);
        assertEq(v.meanScore, (uint256(a) + b) / 2);
        assertLe(v.meanScore, 10_000);
    }
}
