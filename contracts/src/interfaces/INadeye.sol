// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The read side of Nadeye that other contracts build on. An image is identified
///         by its 64-bit DCT perceptual hash, left-padded into a bytes32.
interface INadeye {
    struct ImageView {
        bytes32 pHash;
        uint32 reports; // scanners that recorded a verdict
        uint32 aiVotes; // of those, verdicts with score >= AI_THRESHOLD
        uint16 meanScore; // mean AI confidence, basis points (0..10000)
        address firstScanner;
        uint40 firstSeen;
        uint40 lastSeen;
    }

    function AI_THRESHOLD() external view returns (uint16);
    function REAL_CEILING() external view returns (uint16);
    function getImage(bytes32 pHash) external view returns (ImageView memory);
    function getImages(bytes32[] calldata pHashes) external view returns (ImageView[] memory);
    function agentOf(address scanner) external view returns (bool linked, uint256 agentId);
    function hasAttested(bytes32 pHash, address scanner) external view returns (bool);
}

/// @notice The passkey side: which accounts proved a P256 passkey, and passkey approval of actions.
interface IPasskeyRegistry {
    struct WebAuthnAuth {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        bytes32 r;
        bytes32 s;
    }

    function hasPasskey(address account) external view returns (bool);
    function verifyFor(address account, bytes32 challenge, WebAuthnAuth calldata auth) external view returns (bool);
}
