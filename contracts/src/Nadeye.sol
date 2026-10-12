// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev the slices of the ERC-8004 registries Nadeye uses
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IERC8004Reputation {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/// @title Nadeye — an onchain registry of AI-image verdicts on Monad
/// @notice The Nadeye browser extension detects AI-generated images locally
///         (WebGPU/WASM, nothing uploaded) and attests its verdict here, keyed by
///         the image's 64-bit perceptual hash. The image itself never touches
///         the chain. Scanners earn points for coverage, for first discoveries
///         and for agreeing with the existing consensus — the leaderboard
///         (points, active days, signal-to-noise) is read straight from this
///         contract, no backend required.
///
///         ERC-8004: a scanner (human-run extension or autonomous agent) can
///         link its ERC-8004 agent identity. From then on every consensus
///         judgement on its verdicts is written to the ERC-8004 Reputation
///         Registry with this contract as the client (100 = agreed, 0 =
///         disagreed, tag1 "nadeye", tag2 "consensus"), so any app can read
///         a detector's track record without trusting Nadeye's own UI.
contract Nadeye {
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
    /// gas forwarded to ERC-8004 giveFeedback. The reference registry uses
    /// 72k-174k; the cap stops a heavy or hostile (the registry is an
    /// upgradeable proxy) implementation from making attestations revert.
    uint256 public constant REPUTATION_GAS = 300_000;

    // ----------------------------------------------------------------- state

    IERC8004Identity public immutable identityRegistry;
    IERC8004Reputation public immutable reputationRegistry;
    /// scanner => agentId + 1 (0 = not linked; ERC-8004 agent ids start at 0)
    mapping(address => uint256) internal _agentOf;

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
    event AgentLinked(address indexed scanner, uint256 indexed agentId);
    event AgentUnlinked(address indexed scanner, uint256 indexed agentId);
    event ReputationSkipped(address indexed scanner, uint256 indexed agentId, bytes32 pHash);

    error InvalidScore();
    error AlreadyAttested();
    error EmptyHash();
    error BatchTooLarge();
    error LengthMismatch();
    error HandleTooLong();
    error NoIdentityRegistry();
    error NotAgentController();

    /// @param identity   ERC-8004 Identity Registry (0 disables agent linking)
    /// @param reputation ERC-8004 Reputation Registry (0 disables feedback)
    constructor(address identity, address reputation) {
        identityRegistry = IERC8004Identity(identity);
        reputationRegistry = IERC8004Reputation(reputation);
    }

    // ------------------------------------------------------------- ERC-8004

    /// @notice link the caller's verdicts to an ERC-8004 agent. The caller must
    ///         be the agent's owner or its registered agentWallet, so nobody can
    ///         attach someone else's scanner (or reputation) to their agent.
    function linkAgent(uint256 agentId) external {
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();
        if (!_controls(msg.sender, agentId)) revert NotAgentController();
        _agentOf[msg.sender] = agentId + 1;
        emit AgentLinked(msg.sender, agentId);
    }

    function unlinkAgent() external {
        uint256 a = _agentOf[msg.sender];
        if (a == 0) return;
        delete _agentOf[msg.sender];
        emit AgentUnlinked(msg.sender, a - 1);
    }

    function agentOf(address scanner) public view returns (bool linked, uint256 agentId) {
        uint256 a = _agentOf[scanner];
        return (a != 0, a == 0 ? 0 : a - 1);
    }

    function _controls(address who, uint256 agentId) internal view returns (bool) {
        try identityRegistry.ownerOf(agentId) returns (address owner) {
            if (owner == who) return true;
        } catch {
            return false;
        }
        try identityRegistry.getAgentWallet(agentId) returns (address wallet) {
            return wallet == who;
        } catch {
            return false;
        }
    }

    /// consensus judgement -> ERC-8004 reputation. Never blocks an attestation:
    /// a revoked link or a registry failure only skips the feedback.
    function _reputation(address scanner, bool agreed, bytes32 pHash) internal {
        uint256 a = _agentOf[scanner];
        if (a == 0 || address(reputationRegistry) == address(0)) return;
        uint256 agentId = a - 1;
        if (!_controls(scanner, agentId)) {
            emit ReputationSkipped(scanner, agentId, pHash);
            return;
        }
        try reputationRegistry.giveFeedback{gas: REPUTATION_GAS}(
            agentId, agreed ? int128(100) : int128(0), 0, "nadeye", "consensus", "", "", pHash
        ) {}
        catch {
            emit ReputationSkipped(scanner, agentId, pHash);
        }
    }

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
        int8 consensus = 0; // 1 agreed, -1 disagreed, 0 not judged
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
        // external call last (checks-effects-interactions): a re-entering
        // registry only ever sees fully updated state
        if (consensus != 0) _reputation(msg.sender, consensus == 1, pHash);
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
        bool hasAgent;
        uint256 agentId;
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
        (v.hasAgent, v.agentId) = agentOf(account);
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
