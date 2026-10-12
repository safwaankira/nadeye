// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NadeyeJournal
/// @notice Untrusted, append-only storage for encrypted journals. Each journal is addressed
///         by an opaque id (Nadeye derives it from a passkey PRF namespace, so it says nothing
///         about the account); entries are ciphertext the contract cannot read.
/// @dev    The first account to write a journal id becomes its only writer, so nobody can
///         flood someone else's journal. Contents stay private; the writer address, entry
///         count and timing are public.
contract NadeyeJournal {
    uint256 public constant MAX_ENTRY_BYTES = 512;

    mapping(bytes32 => address) public writerOf;
    mapping(bytes32 => bytes[]) private _entries;

    event Appended(bytes32 indexed journalId, uint256 index);

    error NotWriter(address writer);
    error BadEntry();

    function append(bytes32 journalId, bytes calldata entry) external {
        if (entry.length == 0 || entry.length > MAX_ENTRY_BYTES) revert BadEntry();
        address w = writerOf[journalId];
        if (w == address(0)) writerOf[journalId] = msg.sender;
        else if (w != msg.sender) revert NotWriter(w);
        _entries[journalId].push(entry);
        emit Appended(journalId, _entries[journalId].length - 1);
    }

    function count(bytes32 journalId) external view returns (uint256) {
        return _entries[journalId].length;
    }

    /// @notice entries [offset, offset + limit), clipped to the journal's length
    function entries(bytes32 journalId, uint256 offset, uint256 limit) external view returns (bytes[] memory out) {
        bytes[] storage all = _entries[journalId];
        if (offset >= all.length) return new bytes[](0);
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        out = new bytes[](end - offset);
        for (uint256 i = offset; i < end; ++i) out[i - offset] = all[i];
    }
}
