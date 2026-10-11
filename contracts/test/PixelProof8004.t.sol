// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PixelProof} from "../src/PixelProof.sol";
import {HardhatMinimalUUPS} from "./erc8004/HardhatMinimalUUPS.sol";
import {IdentityRegistryUpgradeable} from "./erc8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "./erc8004/ReputationRegistryUpgradeable.sol";

/// Runs PixelProof against the real ERC-8004 reference registries, deployed the
/// way they are on Monad (proxy -> MinimalUUPS -> upgrade to registry).
contract PixelProof8004Test is Test {
    IdentityRegistryUpgradeable identity;
    ReputationRegistryUpgradeable reputation;
    PixelProof pp;

    uint256 ownerPk = 0xA11CE;
    uint256 scannerPk = 0x5CA22E2;
    address owner;
    address scanner;
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    bytes32 constant IMG = bytes32(uint256(0xfeed));

    function _proxy(address identityArg) internal returns (address) {
        HardhatMinimalUUPS boot = new HardhatMinimalUUPS();
        return address(new ERC1967Proxy(address(boot), abi.encodeCall(HardhatMinimalUUPS.initialize, (identityArg))));
    }

    function setUp() public {
        vm.warp(1_760_000_000);
        owner = vm.addr(ownerPk);
        scanner = vm.addr(scannerPk);

        address idProxy = _proxy(address(0));
        HardhatMinimalUUPS(idProxy).upgradeToAndCall(
            address(new IdentityRegistryUpgradeable()), abi.encodeCall(IdentityRegistryUpgradeable.initialize, ())
        );
        identity = IdentityRegistryUpgradeable(idProxy);

        address repProxy = _proxy(idProxy);
        HardhatMinimalUUPS(repProxy).upgradeToAndCall(
            address(new ReputationRegistryUpgradeable()), abi.encodeCall(ReputationRegistryUpgradeable.initialize, (idProxy))
        );
        reputation = ReputationRegistryUpgradeable(repProxy);

        pp = new PixelProof(address(identity), address(reputation));
    }

    function _register(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = identity.register("data:application/json,{\"name\":\"scanner\"}");
    }

    function test_ownerCanLink_strangerCannot() public {
        uint256 id = _register(scanner);
        vm.prank(bob);
        vm.expectRevert(PixelProof.NotAgentController.selector);
        pp.linkAgent(id);

        vm.prank(scanner);
        pp.linkAgent(id);
        (bool linked, uint256 got) = pp.agentOf(scanner);
        assertTrue(linked);
        assertEq(got, id);
        PixelProof.ScannerView memory v = pp.getScanner(scanner);
        assertTrue(v.hasAgent);
        assertEq(v.agentId, id);
    }

    function test_agentIdZeroIsLinkable() public {
        uint256 id = _register(scanner);
        assertEq(id, 0);
        vm.prank(scanner);
        pp.linkAgent(id);
        (bool linked,) = pp.agentOf(scanner);
        assertTrue(linked);
    }

    /// passkey flow: a cold identity key owns the agent, the hot scanner key in
    /// the extension is its agentWallet (set with the scanner's EIP-712 consent)
    function test_agentWalletCanLink() public {
        uint256 id = _register(owner);
        uint256 deadline = block.timestamp + 60;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"),
                id, scanner, owner, deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC8004IdentityRegistry"), keccak256("1"), block.chainid, address(identity)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(scannerPk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        vm.prank(owner);
        identity.setAgentWallet(id, scanner, deadline, abi.encodePacked(r, s, v));
        assertEq(identity.getAgentWallet(id), scanner);

        vm.prank(scanner);
        pp.linkAgent(id);
        (bool linked,) = pp.agentOf(scanner);
        assertTrue(linked);
    }

    function test_consensusWritesReputation() public {
        uint256 id = _register(scanner);
        vm.prank(scanner);
        pp.linkAgent(id);

        vm.prank(bob); pp.attest(IMG, 9_000, 1);
        vm.prank(carol); pp.attest(IMG, 8_000, 1);
        vm.prank(scanner); pp.attest(IMG, 9_500, 1);            // agrees -> 100
        vm.prank(scanner); pp.attest(bytes32(uint256(7)), 9_000, 1); // first find, not judged

        assertEq(reputation.getLastIndex(id, address(pp)), 1);
        (int128 value,, string memory tag1, string memory tag2, bool revoked) = reputation.readFeedback(id, address(pp), 1);
        assertEq(value, 100);
        assertEq(tag1, "pixelproof");
        assertEq(tag2, "consensus");
        assertFalse(revoked);

        // a disagreement is recorded as 0
        bytes32 img2 = bytes32(uint256(0xbeef));
        vm.prank(bob); pp.attest(img2, 1_000, 1);
        vm.prank(carol); pp.attest(img2, 2_000, 1);
        vm.prank(scanner); pp.attest(img2, 9_900, 1);
        (value,,,,) = reputation.readFeedback(id, address(pp), 2);
        assertEq(value, 0);

        address[] memory clients = new address[](1);
        clients[0] = address(pp);
        (uint64 count, int128 summary,) = reputation.getSummary(id, clients, "pixelproof", "consensus");
        assertEq(count, 2);
        assertEq(summary, 50); // average of 100 and 0 == the scanner's signal-to-noise
    }

    function test_revokedControlSkipsFeedbackButKeepsAttesting() public {
        uint256 id = _register(scanner);
        vm.prank(scanner);
        pp.linkAgent(id);
        // the agent NFT moves away: the scanner no longer controls it
        vm.prank(scanner);
        identity.transferFrom(scanner, bob, id);

        vm.prank(bob); pp.attest(IMG, 9_000, 1);
        vm.prank(carol); pp.attest(IMG, 8_000, 1);
        vm.prank(scanner); pp.attest(IMG, 9_500, 1); // still recorded
        assertEq(pp.getScanner(scanner).signal, 1);
        assertEq(reputation.getLastIndex(id, address(pp)), 0);
    }

    function test_unlink() public {
        uint256 id = _register(scanner);
        vm.startPrank(scanner);
        pp.linkAgent(id);
        pp.unlinkAgent();
        (bool linked,) = pp.agentOf(scanner);
        assertFalse(linked);
    }

    function test_noRegistryMeansNoLinking() public {
        PixelProof bare = new PixelProof(address(0), address(0));
        vm.expectRevert(PixelProof.NoIdentityRegistry.selector);
        bare.linkAgent(1);
    }
}
