// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PixelProof} from "../src/PixelProof.sol";

/// Deploys PixelProof wired to the live ERC-8004 registries.
///   forge script script/Deploy.s.sol --rpc-url monad_mainnet --account deployer --broadcast
/// Other chains: set ERC8004_IDENTITY / ERC8004_REPUTATION (or 0x0 to disable).
contract Deploy is Script {
    // CREATE2-deterministic ERC-8004 registries (erc-8004.quicknode.com/docs/contracts)
    address constant MAINNET_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant MAINNET_REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant TESTNET_IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant TESTNET_REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external returns (PixelProof pp) {
        address identity;
        address reputation;
        if (block.chainid == 143) {
            (identity, reputation) = (MAINNET_IDENTITY, MAINNET_REPUTATION);
        } else if (block.chainid == 10143) {
            (identity, reputation) = (TESTNET_IDENTITY, TESTNET_REPUTATION);
        } else {
            identity = vm.envOr("ERC8004_IDENTITY", address(0));
            reputation = vm.envOr("ERC8004_REPUTATION", address(0));
        }
        if (identity != address(0)) require(identity.code.length > 0, "identity registry not deployed here");
        if (reputation != address(0)) require(reputation.code.length > 0, "reputation registry not deployed here");

        vm.startBroadcast();
        pp = new PixelProof(identity, reputation);
        vm.stopBroadcast();
        console.log("PixelProof deployed at", address(pp));
        console.log("chain id", block.chainid);
        console.log("ERC-8004 identity", identity);
        console.log("ERC-8004 reputation", reputation);
    }
}
