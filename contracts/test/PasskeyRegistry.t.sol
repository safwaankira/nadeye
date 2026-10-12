// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";

/// Assertions are built the way a browser builds them: clientDataJSON with type, challenge
/// (base64url) and origin; authenticatorData = rpIdHash || flags || signCount; the P256
/// signature over sha256(authenticatorData || sha256(clientDataJSON)), s normalised low.
contract PasskeyRegistryTest is Test {
    PasskeyRegistry reg;
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 pkA = 0xA11CE;
    uint256 pkB = 0xB0B;
    address alice = address(0xA1);
    address bob = address(0xB2);

    function setUp() public {
        reg = new PasskeyRegistry();
    }

    function _pub(uint256 pk) internal pure returns (bytes32, bytes32) {
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        return (bytes32(x), bytes32(y));
    }

    function _assert(uint256 pk, bytes32 challenge, string memory typ, bytes1 flags)
        internal
        pure
        returns (PasskeyRegistry.WebAuthnAuth memory a)
    {
        string memory prefix = string.concat('{"type":"', typ, '",');
        a.clientDataJSON = string.concat(prefix, '"challenge":"', Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"https://nadeye.example","crossOrigin":false}');
        a.typeIndex = 1;
        a.challengeIndex = bytes(prefix).length;
        a.authenticatorData = abi.encodePacked(sha256("nadeye.example"), flags, uint32(7));
        bytes32 h = sha256(abi.encodePacked(a.authenticatorData, sha256(bytes(a.clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(pk, h);
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s));
        a.r = r;
        a.s = s;
    }

    function _good(uint256 pk, address who) internal view returns (PasskeyRegistry.WebAuthnAuth memory) {
        return _assert(pk, reg.registrationChallenge(who), "webauthn.get", 0x05);
    }

    function test_registerWithProofOfPossession() public {
        (bytes32 x, bytes32 y) = _pub(pkA);
        PasskeyRegistry.WebAuthnAuth memory a = _good(pkA, alice);
        vm.expectEmit(true, true, false, true);
        emit PasskeyRegistry.PasskeyRegistered(alice, keccak256(abi.encode(x, y)), x, y);
        vm.prank(alice);
        reg.register(x, y, a);
        assertTrue(reg.hasPasskey(alice));
        assertEq(reg.accountOfKey(keccak256(abi.encode(x, y))), alice);
        assertEq(reg.nonceOf(alice), 1);
        (bool ok, bytes32 rx,,) = reg.passkeyOf(alice);
        assertTrue(ok);
        assertEq(rx, x);
    }

    function test_proofIsBoundToAccountAndCannotBeReplayed() public {
        (bytes32 x, bytes32 y) = _pub(pkA);
        PasskeyRegistry.WebAuthnAuth memory a = _good(pkA, alice);
        vm.prank(bob); // alice's proof does not register bob
        vm.expectRevert(PasskeyRegistry.BadAssertion.selector);
        reg.register(x, y, a);
        vm.prank(alice);
        reg.register(x, y, a);
        vm.prank(alice);
        reg.unregister();
        vm.prank(alice); // the nonce moved on, so the old proof is dead
        vm.expectRevert(PasskeyRegistry.BadAssertion.selector);
        reg.register(x, y, a);
    }

    function test_onePasskeyBacksOneAccount() public {
        (bytes32 x, bytes32 y) = _pub(pkA);
        PasskeyRegistry.WebAuthnAuth memory auth1 = _good(pkA, alice);
        vm.prank(alice);
        reg.register(x, y, auth1);
        PasskeyRegistry.WebAuthnAuth memory b = _good(pkA, bob);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PasskeyRegistry.KeyInUse.selector, alice));
        reg.register(x, y, b);
    }

    function test_rotationFreesTheOldKey() public {
        (bytes32 xa, bytes32 ya) = _pub(pkA);
        (bytes32 xb, bytes32 yb) = _pub(pkB);
        PasskeyRegistry.WebAuthnAuth memory auth2 = _good(pkA, alice);
        vm.prank(alice);
        reg.register(xa, ya, auth2);
        PasskeyRegistry.WebAuthnAuth memory auth3 = _good(pkB, alice);
        vm.prank(alice);
        reg.register(xb, yb, auth3);
        assertEq(reg.accountOfKey(keccak256(abi.encode(xa, ya))), address(0));
        PasskeyRegistry.WebAuthnAuth memory auth4 = _good(pkA, bob);
        vm.prank(bob); // the freed key can now back bob
        reg.register(xa, ya, auth4);
        assertEq(reg.accountOfKey(keccak256(abi.encode(xa, ya))), bob);
    }

    function test_rejectsBadAssertions() public view {
        (bytes32 x, bytes32 y) = _pub(pkA);
        bytes32 c = reg.registrationChallenge(alice);
        // a registration ceremony's signature is not an authentication
        assertFalse(reg.verify(c, _assert(pkA, c, "webauthn.create", 0x05), x, y));
        // user present but not verified
        assertFalse(reg.verify(c, _assert(pkA, c, "webauthn.get", 0x01), x, y));
        // a different challenge
        assertFalse(reg.verify(c, _assert(pkA, keccak256("other"), "webauthn.get", 0x05), x, y));
        // another key
        assertFalse(reg.verify(c, _assert(pkB, c, "webauthn.get", 0x05), x, y));
        // tampered clientDataJSON (the origin changes after signing)
        PasskeyRegistry.WebAuthnAuth memory t = _assert(pkA, c, "webauthn.get", 0x05);
        bytes memory j = bytes(t.clientDataJSON);
        j[j.length - 25] = "X";
        t.clientDataJSON = string(j);
        assertFalse(reg.verify(c, t, x, y));
        // malleated high-s twin of a valid signature
        PasskeyRegistry.WebAuthnAuth memory m = _assert(pkA, c, "webauthn.get", 0x05);
        assertTrue(reg.verify(c, m, x, y));
        m.s = bytes32(N - uint256(m.s));
        assertFalse(reg.verify(c, m, x, y));
        // out-of-range indexes do not revert
        PasskeyRegistry.WebAuthnAuth memory o = _assert(pkA, c, "webauthn.get", 0x05);
        o.challengeIndex = type(uint256).max;
        assertFalse(reg.verify(c, o, x, y));
        // short authenticatorData
        o = _assert(pkA, c, "webauthn.get", 0x05);
        o.authenticatorData = hex"00";
        assertFalse(reg.verify(c, o, x, y));
    }

    function test_rejectsInvalidPublicKey() public {
        PasskeyRegistry.WebAuthnAuth memory a = _good(pkA, alice);
        vm.prank(alice);
        vm.expectRevert(PasskeyRegistry.InvalidPublicKey.selector);
        reg.register(bytes32(uint256(1)), bytes32(uint256(2)), a);
    }

    function test_verifyForLetsOtherContractsRequirePasskeyApproval() public {
        (bytes32 x, bytes32 y) = _pub(pkA);
        PasskeyRegistry.WebAuthnAuth memory auth5 = _good(pkA, alice);
        vm.prank(alice);
        reg.register(x, y, auth5);
        bytes32 action = keccak256("approve: list image 0xfeed as AI");
        PasskeyRegistry.WebAuthnAuth memory a = _assert(pkA, action, "webauthn.get", 0x05);
        assertTrue(reg.verifyFor(alice, action, a));
        assertFalse(reg.verifyFor(bob, action, a)); // bob has no passkey
        address[] memory who = new address[](2);
        who[0] = alice;
        who[1] = bob;
        bool[] memory has = reg.hasPasskeys(who);
        assertTrue(has[0]);
        assertFalse(has[1]);
    }

    function testFuzz_signedChallengeVerifiesAndAnyFlipFails(uint256 pk, bytes32 challenge, uint8 flip) public view {
        pk = bound(pk, 1, N - 1);
        (bytes32 x, bytes32 y) = _pub(pk);
        PasskeyRegistry.WebAuthnAuth memory a = _assert(pk, challenge, "webauthn.get", 0x05);
        assertTrue(reg.verify(challenge, a, x, y));
        bytes32 other = challenge ^ bytes32(uint256(1) << flip);
        assertFalse(reg.verify(other, a, x, y));
    }

    function test_gasOfVerify() public {
        (bytes32 x, bytes32 y) = _pub(pkA);
        bytes32 c = reg.registrationChallenge(alice);
        PasskeyRegistry.WebAuthnAuth memory a = _assert(pkA, c, "webauthn.get", 0x05);
        uint256 g = gasleft();
        assertTrue(reg.verify(c, a, x, y));
        // ~283k with the Solidity fallback (default EVM here); ~35k with the 0x100 precompile Monad has
        // (run `forge test --evm-version osaka` to use it)
        emit log_named_uint("verify gas", g - gasleft());
    }
}
