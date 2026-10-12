// Generated from contracts/out/Nadeye.sol/Nadeye.json — run npm run abi after changing the contract
export const nadeyeAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "identity",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "reputation",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "AI_THRESHOLD",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "DAILY_POINT_CAP",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_BATCH",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_SCORE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "POINTS_AGREE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "POINTS_FIRST",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "POINTS_SCAN",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "QUORUM",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "agentOf",
  "inputs": [
   {
    "name": "scanner",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "linked",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "agentId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "attest",
  "inputs": [
   {
    "name": "pHash",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "score",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "modelVersion",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "attestBatch",
  "inputs": [
   {
    "name": "pHashes",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
   },
   {
    "name": "scores",
    "type": "uint16[]",
    "internalType": "uint16[]"
   },
   {
    "name": "modelVersion",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "outputs": [
   {
    "name": "recorded",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "getImage",
  "inputs": [
   {
    "name": "pHash",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "outputs": [
   {
    "name": "v",
    "type": "tuple",
    "internalType": "struct Nadeye.ImageView",
    "components": [
     {
      "name": "pHash",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "reports",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "aiVotes",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "meanScore",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "firstScanner",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "firstSeen",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "lastSeen",
      "type": "uint40",
      "internalType": "uint40"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getImages",
  "inputs": [
   {
    "name": "pHashes",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
   }
  ],
  "outputs": [
   {
    "name": "out",
    "type": "tuple[]",
    "internalType": "struct Nadeye.ImageView[]",
    "components": [
     {
      "name": "pHash",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "reports",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "aiVotes",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "meanScore",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "firstScanner",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "firstSeen",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "lastSeen",
      "type": "uint40",
      "internalType": "uint40"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getScanner",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "v",
    "type": "tuple",
    "internalType": "struct Nadeye.ScannerView",
    "components": [
     {
      "name": "account",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "handle",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "points",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "scans",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "firsts",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "signal",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "noise",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "activeDays",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "joined",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "hasAgent",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "agentId",
      "type": "uint256",
      "internalType": "uint256"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getScanners",
  "inputs": [
   {
    "name": "offset",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "limit",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "out",
    "type": "tuple[]",
    "internalType": "struct Nadeye.ScannerView[]",
    "components": [
     {
      "name": "account",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "handle",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "points",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "scans",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "firsts",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "signal",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "noise",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "activeDays",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "joined",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "hasAgent",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "agentId",
      "type": "uint256",
      "internalType": "uint256"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "handleOf",
  "inputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "string",
    "internalType": "string"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "hasAttested",
  "inputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "identityRegistry",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IERC8004Identity"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "imageCount",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "linkAgent",
  "inputs": [
   {
    "name": "agentId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "recentImages",
  "inputs": [
   {
    "name": "limit",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "out",
    "type": "tuple[]",
    "internalType": "struct Nadeye.ImageView[]",
    "components": [
     {
      "name": "pHash",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "reports",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "aiVotes",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "meanScore",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "firstScanner",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "firstSeen",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "lastSeen",
      "type": "uint40",
      "internalType": "uint40"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "reputationRegistry",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IERC8004Reputation"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "scannerCount",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "setHandle",
  "inputs": [
   {
    "name": "handle",
    "type": "string",
    "internalType": "string"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "stats",
  "inputs": [],
  "outputs": [
   {
    "name": "scans",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "images",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "scanners",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "flagged",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "totalFlagged",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "totalScans",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "unlinkAgent",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "AgentLinked",
  "inputs": [
   {
    "name": "scanner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "agentId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "AgentUnlinked",
  "inputs": [
   {
    "name": "scanner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "agentId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Attested",
  "inputs": [
   {
    "name": "pHash",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "scanner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "score",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "modelVersion",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "first",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "consensus",
    "type": "int8",
    "indexed": false,
    "internalType": "int8"
   },
   {
    "name": "pointsAwarded",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "HandleSet",
  "inputs": [
   {
    "name": "scanner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "handle",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ReputationSkipped",
  "inputs": [
   {
    "name": "scanner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "agentId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "pHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AlreadyAttested",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BatchTooLarge",
  "inputs": []
 },
 {
  "type": "error",
  "name": "EmptyHash",
  "inputs": []
 },
 {
  "type": "error",
  "name": "HandleTooLong",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidScore",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LengthMismatch",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoIdentityRegistry",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotAgentController",
  "inputs": []
 }
];
