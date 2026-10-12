// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NadeyeJournal} from "../src/NadeyeJournal.sol";

contract NadeyeJournalTest is Test {
    NadeyeJournal j;
    bytes32 constant ID = keccak256("journal");
    address alice = address(0xA1);
    address mallory = address(0xBAD);

    function setUp() public {
        j = new NadeyeJournal();
    }

    function test_firstWriterOwnsTheJournal() public {
        vm.prank(alice);
        j.append(ID, hex"0102");
        assertEq(j.writerOf(ID), alice);
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(NadeyeJournal.NotWriter.selector, alice));
        j.append(ID, hex"ff");
        vm.prank(alice);
        j.append(ID, hex"0304");
        assertEq(j.count(ID), 2);
    }

    function test_pagedReadsClipToLength() public {
        vm.startPrank(alice);
        for (uint256 i; i < 5; ++i) j.append(ID, abi.encodePacked(uint8(i + 1)));
        vm.stopPrank();
        bytes[] memory page = j.entries(ID, 3, 10);
        assertEq(page.length, 2);
        assertEq(page[0], hex"04");
        assertEq(page[1], hex"05");
        assertEq(j.entries(ID, 9, 3).length, 0);
        assertEq(j.entries(keccak256("other"), 0, 3).length, 0);
    }

    function test_rejectsEmptyAndOversizedEntries() public {
        vm.startPrank(alice);
        vm.expectRevert(NadeyeJournal.BadEntry.selector);
        j.append(ID, "");
        vm.expectRevert(NadeyeJournal.BadEntry.selector);
        j.append(ID, new bytes(513));
        j.append(ID, new bytes(512));
        vm.stopPrank();
        assertEq(j.count(ID), 1);
    }

    function testFuzz_entriesRoundTrip(bytes calldata data) public {
        vm.assume(data.length > 0 && data.length <= 512);
        vm.prank(alice);
        j.append(ID, data);
        assertEq(j.entries(ID, 0, 1)[0], data);
    }
}
