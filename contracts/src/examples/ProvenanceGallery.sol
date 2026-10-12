// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INadeye} from "../interfaces/INadeye.sol";

/// @notice Example integration: a gallery (or NFT mint, or "verified photo" feed) that will
///         not list an image the Nadeye community has flagged as AI-generated, and labels
///         everything else with the evidence it had at listing time.
/// @dev    Callers pass the image's pHash (nadeye-sdk's `pHashDetail(imageData).hex`). Pass
///         the hash of the exact file you list; near-variant lookups belong offchain.
contract ProvenanceGallery {
    INadeye public immutable nadeye;
    /// community reports needed before a majority counts (a single report is not consensus)
    uint32 public immutable minReports;

    struct Listing {
        address by;
        uint32 reportsAtListing;
        uint32 aiVotesAtListing;
    }

    mapping(bytes32 => Listing) public listings;

    event Listed(bytes32 indexed pHash, address indexed by, uint32 reports, uint32 aiVotes);

    error FlaggedAsAI(bytes32 pHash, uint32 aiVotes, uint32 reports);
    error AlreadyListed(bytes32 pHash);

    constructor(INadeye nadeye_, uint32 minReports_) {
        nadeye = nadeye_;
        minReports = minReports_;
    }

    /// @notice list an image unless enough scanners say it is AI-generated
    function list(bytes32 pHash) external {
        if (listings[pHash].by != address(0)) revert AlreadyListed(pHash);
        INadeye.ImageView memory v = nadeye.getImage(pHash);
        if (flagged(v)) revert FlaggedAsAI(pHash, v.aiVotes, v.reports);
        listings[pHash] = Listing(msg.sender, v.reports, v.aiVotes);
        emit Listed(pHash, msg.sender, v.reports, v.aiVotes);
    }

    /// @notice the gallery's rule: at least `minReports` reports and a strict AI majority
    function flagged(INadeye.ImageView memory v) public view returns (bool) {
        return v.reports >= minReports && uint256(v.aiVotes) * 2 > v.reports;
    }
}
