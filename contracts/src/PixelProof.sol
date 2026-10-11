// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PixelProof — an onchain registry of AI-image verdicts on Monad
/// @notice The PixelProof browser extension detects AI-generated images locally
///         (WebGPU/WASM, nothing uploaded) and attests its verdict here, keyed by
///         the image's 64-bit perceptual hash. The image itself never touches
///         the chain. Scanners earn points for coverage, for first discoveries
///         and for agreeing with the existing consensus — the leaderboard
///         (points, active days, signal-to-noise) is read straight from this
///         contract, no backend required.
contract PixelProof {
    // ---------------------------------------------------------------- config

    /// score is basis points of AI confidence (0 = surely real, 10000 = surely AI)
    uint16 public constant MAX_SCORE = 10_000;
    /// a report is an "AI" vote at or above this score (Sieve's 65% threshold)
    uint16 public constant AI_THRESHOLD = 6_500;
    /// prior reports needed before agreement/disagreement is judged
    uint32 public constant QUORUM = 2;

    uint64 public constant POINTS_SCAN = 10;
    uint64 public constant POINTS_FIRST = 25;
    uint64 public constant POINTS_AGREE = 15;
    /// scans per address per UTC day that earn points (anti-farming); more are
    /// still recorded, they just score zero
    uint32 public constant DAILY_POINT_CAP = 300;
    uint256 public constant MAX_BATCH = 100;

    // ----------------------------------------------------------------- state

    struct Image {
        uint32 reports;      // attestations received
        uint32 aiVotes;      // attestations at/above AI_THRESHOLD
        uint64 scoreSum;     // sum of scores, for the mean
        address firstScanner;
        uint40 firstSeen;
        uint40 lastSeen;
    }

    struct Scanner {
        uint64 points;
        uint32 scans;        // attestations made
        uint32 firsts;       // images this scanner found first
        uint32 signal;       // agreed with consensus
        uint32 noise;        // disagreed with consensus
        uint32 activeDays;
        uint32 lastDay;      // UTC day index of the last scan
        uint32 dayScans;     // scans on lastDay
        uint40 joined;
    }

    mapping(bytes32 => Image) internal _images;
    mapping(bytes32 => mapping(address => bool)) public hasAttested;
    mapping(address => Scanner) internal _scanners;
    mapping(address => string) public handleOf;

    address[] internal _scannerList;
    bytes32[] internal _imageList;

    uint256 public totalScans;
    uint256 public totalFlagged; // images whose current majority is AI

    // ---------------------------------------------------------------- events

    event Attested(
        bytes32 indexed pHash,
        address indexed scanner,
        uint16 score,
        uint8 modelVersion,
        bool first,
        int8 consensus, // 1 agreed, -1 disagreed, 0 not judged
        uint64 pointsAwarded
    );
    event HandleSet(address indexed scanner, string handle);

    error InvalidScore();
    error AlreadyAttested();
    error EmptyHash();
    error BatchTooLarge();
    error LengthMismatch();
    error HandleTooLong();

    // ------------------------------------------------------------ attesting

    /// @notice attest one verdict; reverts on a duplicate from the same scanner
    function attest(bytes32 pHash, uint16 score, uint8 modelVersion) external {
        if (hasAttested[pHash][msg.sender]) revert AlreadyAttested();
        _attest(pHash, score, modelVersion);
    }

    /// @notice attest many verdicts in one transaction. Duplicates are skipped
    ///         rather than reverting, so one already-seen image cannot sink the
    ///         whole batch. Returns how many were recorded.
    function attestBatch(bytes32[] calldata pHashes, uint16[] calldata scores, uint8 modelVersion)
        external
        returns (uint256 recorded)
    {
        uint256 n = pHashes.length;
        if (n != scores.length) revert LengthMismatch();
        if (n > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i; i < n; ++i) {
            if (hasAttested[pHashes[i]][msg.sender]) continue;
            _attest(pHashes[i], scores[i], modelVersion);
            ++recorded;
        }
    }

    function _attest(bytes32 pHash, uint16 score, uint8 modelVersion) internal {
        if (pHash == bytes32(0)) revert EmptyHash();
        if (score > MAX_SCORE) revert InvalidScore();
        hasAttested[pHash][msg.sender] = true;

        Scanner storage s = _scanners[msg.sender];
        if (s.joined == 0) {
            s.joined = uint40(block.timestamp);
            _scannerList.push(msg.sender);
        }
        uint32 today = uint32(block.timestamp / 1 days);
        if (s.lastDay != today || s.activeDays == 0) {
            s.lastDay = today;
            s.dayScans = 0;
            ++s.activeDays;
        }
        bool earns = s.dayScans < DAILY_POINT_CAP;
        ++s.dayScans;
        ++s.scans;

        Image storage img = _images[pHash];
        bool isAI = score >= AI_THRESHOLD;
        bool first = img.reports == 0;
        int8 consensus;
        uint64 pts = earns ? POINTS_SCAN : 0;

        if (first) {
            img.firstScanner = msg.sender;
            img.firstSeen = uint40(block.timestamp);
            _imageList.push(pHash);
            ++s.firsts;
            if (earns) pts += POINTS_FIRST;
        } else if (img.reports >= QUORUM) {
            uint256 ai2 = uint256(img.aiVotes) * 2;
            if (ai2 != img.reports) { // no clear majority on a tie
                bool majorityAI = ai2 > img.reports;
                if (majorityAI == isAI) {
                    consensus = 1;
                    ++s.signal;
                    if (earns) pts += POINTS_AGREE;
                } else {
                    consensus = -1;
                    ++s.noise;
                }
            }
        }

        bool wasAI = img.reports > 0 && uint256(img.aiVotes) * 2 > img.reports;
        ++img.reports;
        if (isAI) ++img.aiVotes;
        img.scoreSum += score;
        img.lastSeen = uint40(block.timestamp);
        bool nowAI = uint256(img.aiVotes) * 2 > img.reports;
        if (nowAI && !wasAI) ++totalFlagged;
        else if (!nowAI && wasAI) --totalFlagged;

        s.points += pts;
        ++totalScans;
        emit Attested(pHash, msg.sender, score, modelVersion, first, consensus, pts);
    }

    /// @notice optional display name (e.g. an X handle) shown on the leaderboard
    function setHandle(string calldata handle) external {
        if (bytes(handle).length > 32) revert HandleTooLong();
        handleOf[msg.sender] = handle;
        emit HandleSet(msg.sender, handle);
    }

    // ----------------------------------------------------------------- views

    struct ImageView {
        bytes32 pHash;
        uint32 reports;
        uint32 aiVotes;
        uint16 meanScore;
        address firstScanner;
        uint40 firstSeen;
        uint40 lastSeen;
    }

    struct ScannerView {
        address account;
        string handle;
        uint64 points;
        uint32 scans;
        uint32 firsts;
        uint32 signal;
        uint32 noise;
        uint32 activeDays;
        uint40 joined;
    }

    function getImage(bytes32 pHash) public view returns (ImageView memory v) {
        Image storage img = _images[pHash];
        v.pHash = pHash;
        v.reports = img.reports;
        v.aiVotes = img.aiVotes;
        v.meanScore = img.reports == 0 ? 0 : uint16(img.scoreSum / img.reports);
        v.firstScanner = img.firstScanner;
        v.firstSeen = img.firstSeen;
        v.lastSeen = img.lastSeen;
    }

    /// @notice batch lookup — the extension checks a whole page in one eth_call
    function getImages(bytes32[] calldata pHashes) external view returns (ImageView[] memory out) {
        out = new ImageView[](pHashes.length);
        for (uint256 i; i < pHashes.length; ++i) out[i] = getImage(pHashes[i]);
    }

    function getScanner(address account) public view returns (ScannerView memory v) {
        Scanner storage s = _scanners[account];
        v.account = account;
        v.handle = handleOf[account];
        v.points = s.points;
        v.scans = s.scans;
        v.firsts = s.firsts;
        v.signal = s.signal;
        v.noise = s.noise;
        v.activeDays = s.activeDays;
        v.joined = s.joined;
    }

    /// @notice page through every scanner (the leaderboard sorts client-side)
    function getScanners(uint256 offset, uint256 limit) external view returns (ScannerView[] memory out) {
        uint256 n = _scannerList.length;
        if (offset >= n) return new ScannerView[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new ScannerView[](end - offset);
        for (uint256 i = offset; i < end; ++i) out[i - offset] = getScanner(_scannerList[i]);
    }

    /// @notice the most recently discovered images, newest first
    function recentImages(uint256 limit) external view returns (ImageView[] memory out) {
        uint256 n = _imageList.length;
        if (limit > n) limit = n;
        out = new ImageView[](limit);
        for (uint256 i; i < limit; ++i) out[i] = getImage(_imageList[n - 1 - i]);
    }

    function scannerCount() external view returns (uint256) {
        return _scannerList.length;
    }

    function imageCount() external view returns (uint256) {
        return _imageList.length;
    }

    function stats() external view returns (uint256 scans, uint256 images, uint256 scanners, uint256 flagged) {
        return (totalScans, _imageList.length, _scannerList.length, totalFlagged);
    }
}
