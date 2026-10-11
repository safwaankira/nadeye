// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PixelProof} from "../src/PixelProof.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --account deployer --broadcast
contract Deploy is Script {
    function run() external returns (PixelProof pp) {
        vm.startBroadcast();
        pp = new PixelProof();
        vm.stopBroadcast();
        console.log("PixelProof deployed at", address(pp));
        console.log("block", block.number);
    }
}
