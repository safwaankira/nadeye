// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title PasskeyRegistry
/// @notice Binds an EVM account to one WebAuthn passkey (a P256 key), proven onchain with
///         Monad's P256 precompile, and lets any contract check that an action was approved
///         by that account's passkey.
/// @dev    Nadeye uses it to mark scanners whose key is held behind a passkey; one passkey
///         can back only one account. This is friction against sybils, not proof of
///         personhood: a person can still create several passkeys.
contract PasskeyRegistry {
    /// A WebAuthn assertion, as the browser returns it, with the signature split into r, s
    /// (s normalised to the lower half of the curve order).
    struct WebAuthnAuth {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex; // where `"challenge":"…"` starts in clientDataJSON
        uint256 typeIndex; // where `"type":"webauthn.get"` starts in clientDataJSON
        bytes32 r;
        bytes32 s;
    }

    struct Passkey {
        bytes32 x;
        bytes32 y;
        uint64 registeredAt;
    }

    mapping(address => Passkey) private _keyOf;
    /// keccak256(x, y) => account that registered it
    mapping(bytes32 => address) public accountOfKey;
    /// bumped on every register/unregister so an old registration proof cannot be replayed
    mapping(address => uint256) public nonceOf;

    event PasskeyRegistered(address indexed account, bytes32 indexed keyHash, bytes32 x, bytes32 y);
    event PasskeyRemoved(address indexed account, bytes32 indexed keyHash);

    error InvalidPublicKey();
    error KeyInUse(address account);
    error BadAssertion();

    bytes1 private constant FLAG_UP = 0x01; // user present
    bytes1 private constant FLAG_UV = 0x04; // user verified

    /// @notice the challenge the passkey must sign to register for `account`
    function registrationChallenge(address account) public view returns (bytes32) {
        return keccak256(abi.encode("nadeye.passkey.register", block.chainid, address(this), account, nonceOf[account]));
    }

    /// @notice bind the caller to the passkey with public key (x, y), proven by an assertion
    ///         over {registrationChallenge}. Replaces any passkey the caller had.
    function register(bytes32 x, bytes32 y, WebAuthnAuth calldata auth) external {
        if (!P256.isValidPublicKey(x, y)) revert InvalidPublicKey();
        bytes32 keyHash = keccak256(abi.encode(x, y));
        address holder = accountOfKey[keyHash];
        if (holder != address(0) && holder != msg.sender) revert KeyInUse(holder);
        if (!verify(registrationChallenge(msg.sender), auth, x, y)) revert BadAssertion();

        Passkey memory old = _keyOf[msg.sender];
        if (old.registeredAt != 0) delete accountOfKey[keccak256(abi.encode(old.x, old.y))];
        _keyOf[msg.sender] = Passkey(x, y, uint64(block.timestamp));
        accountOfKey[keyHash] = msg.sender;
        unchecked { ++nonceOf[msg.sender]; }
        emit PasskeyRegistered(msg.sender, keyHash, x, y);
    }

    /// @notice remove the caller's passkey
    function unregister() external {
        Passkey memory old = _keyOf[msg.sender];
        if (old.registeredAt == 0) return;
        bytes32 keyHash = keccak256(abi.encode(old.x, old.y));
        delete accountOfKey[keyHash];
        delete _keyOf[msg.sender];
        unchecked { ++nonceOf[msg.sender]; }
        emit PasskeyRemoved(msg.sender, keyHash);
    }

    function passkeyOf(address account) external view returns (bool registered, bytes32 x, bytes32 y, uint64 registeredAt) {
        Passkey memory k = _keyOf[account];
        return (k.registeredAt != 0, k.x, k.y, k.registeredAt);
    }

    function hasPasskey(address account) public view returns (bool) {
        return _keyOf[account].registeredAt != 0;
    }

    /// @notice batch form of {hasPasskey}, for leaderboards
    function hasPasskeys(address[] calldata accounts) external view returns (bool[] memory out) {
        out = new bool[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) out[i] = hasPasskey(accounts[i]);
    }

    /// @notice true when `auth` is `account`'s registered passkey signing `challenge`.
    ///         Other contracts use this to require passkey approval for an action.
    function verifyFor(address account, bytes32 challenge, WebAuthnAuth calldata auth) external view returns (bool) {
        Passkey memory k = _keyOf[account];
        return k.registeredAt != 0 && verify(challenge, auth, k.x, k.y);
    }

    /// @notice verify a WebAuthn assertion by public key (x, y) over `challenge`
    /// @dev checks the user-presence and user-verification flags, that clientDataJSON is a
    ///      `webauthn.get` carrying exactly this challenge (base64url), then the P256
    ///      signature over sha256(authenticatorData || sha256(clientDataJSON)) via the
    ///      RIP-7212 precompile (0x100, available on Monad) with a Solidity fallback.
    function verify(bytes32 challenge, WebAuthnAuth calldata auth, bytes32 x, bytes32 y) public view returns (bool) {
        bytes calldata ad = auth.authenticatorData;
        if (ad.length < 37) return false;
        bytes1 flags = ad[32];
        if (flags & FLAG_UP != FLAG_UP || flags & FLAG_UV != FLAG_UV) return false;

        bytes memory json = bytes(auth.clientDataJSON);
        if (!_at(json, auth.typeIndex, '"type":"webauthn.get"')) return false;
        string memory expected = string.concat('"challenge":"', Base64.encodeURL(abi.encodePacked(challenge)), '"');
        if (!_at(json, auth.challengeIndex, expected)) return false;

        bytes32 h = sha256(abi.encodePacked(ad, sha256(json)));
        return P256.verify(h, auth.r, auth.s, x, y);
    }

    function _at(bytes memory haystack, uint256 at, string memory needle) private pure returns (bool) {
        bytes memory n = bytes(needle);
        if (at > haystack.length || haystack.length - at < n.length) return false;
        for (uint256 i; i < n.length; ++i) if (haystack[at + i] != n[i]) return false;
        return true;
    }
}
