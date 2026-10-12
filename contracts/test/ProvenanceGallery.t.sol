// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Nadeye} from "../src/Nadeye.sol";
import {INadeye} from "../src/interfaces/INadeye.sol";
import {ProvenanceGallery} from "../src/examples/ProvenanceGallery.sol";

/// The example integration against the real Nadeye contract, through INadeye only.
contract ProvenanceGalleryTest is Test {
    Nadeye nadeye;
    ProvenanceGallery gallery;
    bytes32 constant AI_IMG = bytes32(uint256(0xa1));
    bytes32 constant REAL_IMG = bytes32(uint256(0xb2));
    bytes32 constant NEW_IMG = bytes32(uint256(0xc3));

    function setUp() public {
        nadeye = new Nadeye(address(0), address(0));
        gallery = new ProvenanceGallery(INadeye(address(nadeye)), 2);
        vm.prank(address(1)); nadeye.attest(AI_IMG, 9_400, 1);
        vm.prank(address(2)); nadeye.attest(AI_IMG, 8_600, 1);
        vm.prank(address(1)); nadeye.attest(REAL_IMG, 900, 1);
        vm.prank(address(2)); nadeye.attest(REAL_IMG, 8_200, 1); // 1 of 2: a tie, not a majority
    }

    function test_refusesAnImageTheCommunityFlagged() public {
        vm.expectRevert(abi.encodeWithSelector(ProvenanceGallery.FlaggedAsAI.selector, AI_IMG, uint32(2), uint32(2)));
        gallery.list(AI_IMG);
    }

    function test_listsUnflaggedImagesWithTheirEvidence() public {
        gallery.list(REAL_IMG);
        (address by, uint32 reports, uint32 aiVotes) = gallery.listings(REAL_IMG);
        assertEq(by, address(this));
        assertEq(reports, 2);
        assertEq(aiVotes, 1);
        gallery.list(NEW_IMG); // never scanned: listed, with zero reports on record
        (, reports,) = gallery.listings(NEW_IMG);
        assertEq(reports, 0);
        vm.expectRevert(abi.encodeWithSelector(ProvenanceGallery.AlreadyListed.selector, NEW_IMG));
        gallery.list(NEW_IMG);
    }

    function test_interfaceMatchesTheContract() public view {
        INadeye i = INadeye(address(nadeye));
        assertEq(i.AI_THRESHOLD(), 8_000);
        assertEq(i.REAL_CEILING(), 5_000);
        assertEq(i.getImage(AI_IMG).aiVotes, 2);
        assertTrue(i.hasAttested(AI_IMG, address(1)));
        (bool linked,) = i.agentOf(address(1));
        assertFalse(linked);
    }
}
