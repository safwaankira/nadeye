// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Nadeye} from "../src/Nadeye.sol";
import {HardhatMinimalUUPS} from "./erc8004/HardhatMinimalUUPS.sol";
import {IdentityRegistryUpgradeable} from "./erc8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "./erc8004/ReputationRegistryUpgradeable.sol";

/// Caller that makes exactly Nadeye's reputation call, so the measured frame is
/// the one Nadeye's REPUTATION_GAS stipend has to cover.
contract FeedbackCaller {
    function call(ReputationRegistryUpgradeable r, uint256 agentId, bytes32 h) external returns (uint256 used) {
        uint256 g = gasleft();
        r.giveFeedback(agentId, int128(100), 0, "nadeye", "consensus", "", "", h);
        used = g - gasleft();
    }
}

/// Upper bound on what Nadeye's giveFeedback call costs under Monad's repricing
/// (docs.monad.xyz/developer-essentials/opcode-pricing): cold account 10,100
/// (Ethereum 2,600); cold storage page 8,100 (Ethereum 2,100 per slot); a fresh
/// slot 100 + 8,000 + 2,800 + 17,000 (Ethereum 22,100 cold). Every slot is
/// treated as its own page, which can only overcount.
contract MonadGasTest is Test {
    IdentityRegistryUpgradeable identity;
    ReputationRegistryUpgradeable reputation;
    FeedbackCaller caller;

    function _proxy(address identityArg) internal returns (address) {
        HardhatMinimalUUPS boot = new HardhatMinimalUUPS();
        return address(new ERC1967Proxy(address(boot), abi.encodeCall(HardhatMinimalUUPS.initialize, (identityArg))));
    }

    function setUp() public {
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
        caller = new FeedbackCaller();
    }

    function test_monadWorstCaseFitsStipend() public {
        vm.prank(address(0x5CA22E2));
        uint256 id = identity.register("data:application/json,{\"name\":\"scanner\"}");

        vm.cool(address(identity));
        vm.cool(address(reputation));
        vm.startStateDiffRecording();
        uint256 ethUsed = caller.call(reputation, id, bytes32(uint256(0xfeed)));
        Vm.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();

        // distinct accounts touched below the caller frame, and distinct slots
        address[] memory accounts = new address[](acc.length);
        uint256 nAcc;
        uint256 coldReads;
        uint256 freshWrites;
        uint256 overwrites;
        bytes32[] memory seen = new bytes32[](512);
        uint8[] memory kind = new uint8[](512); // 0 read, 1 overwrite, 2 fresh
        bytes32[] memory orig = new bytes32[](512);
        uint256 nSeen;
        for (uint256 i; i < acc.length; i++) {
            address a = acc[i].account;
            if (a != address(caller) && a != address(this)) {
                bool dup;
                for (uint256 j; j < nAcc; j++) if (accounts[j] == a) dup = true;
                if (!dup) accounts[nAcc++] = a;
            }
            for (uint256 k; k < acc[i].storageAccesses.length; k++) {
                Vm.StorageAccess memory s = acc[i].storageAccesses[k];
                bytes32 key = keccak256(abi.encode(s.account, s.slot));
                uint256 idx = type(uint256).max;
                for (uint256 j; j < nSeen; j++) if (seen[j] == key) idx = j;
                if (idx == type(uint256).max) { idx = nSeen++; seen[idx] = key; orig[idx] = s.previousValue; }
                if (s.isWrite && s.newValue != orig[idx]) {
                    uint8 kd = orig[idx] == bytes32(0) ? 2 : 1;
                    if (kd > kind[idx]) kind[idx] = kd;
                }
            }
        }
        for (uint256 j; j < nSeen; j++) {
            if (kind[j] == 2) freshWrites++;
            else if (kind[j] == 1) overwrites++;
            else coldReads++;
        }
        // Monad minus Ethereum, per item
        uint256 extra = nAcc * (10_100 - 2_600) + coldReads * (8_100 - 2_100)
            + freshWrites * (27_900 - 22_100) + overwrites * (8_100 + 2_800 + 100 - 5_000);
        uint256 monad = ethUsed + extra;
        console2.log("ethereum gas", ethUsed);
        console2.log("accounts", nAcc);
        console2.log("cold slot reads", coldReads);
        console2.log("fresh slot writes", freshWrites);
        console2.log("overwrites", overwrites);
        console2.log("monad upper bound", monad);
        console2.log("stipend", pBound());
        assertLt(monad, pBound(), "Monad worst case must fit REPUTATION_GAS");
    }

    function pBound() internal returns (uint256) {
        return new Nadeye(address(identity), address(reputation)).REPUTATION_GAS();
    }
}
