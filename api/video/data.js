window.DATA = {
  "generatedAt": "2026-10-26T15:31:19.602Z",
  "order": {
    "no": "WL202610262773902485",
    "versionNo": 50,
    "payloadHash": "00bee831a6abf816d2395e9417697cac58308eee890c4f5afa260ab6bfbbb2c2",
    "merkleRoot": "d58f6762dde5a1ebba5dd0bc0954fbad829756006ea6587a5391cbcfeeaf35fc",
    "prevRoot": null,
    "batchSeq": 1,
    "leafIndex": 5,
    "leafCount": 10,
    "proofValid": true,
    "leafPath": [
      {
        "h": "190f95cac7e9b603317d3c4d5f29e605c3a5eca154d2c58f9e7fe2b7e951cfd1",
        "p": "L",
        "dup": false
      },
      {
        "h": "6f9de8b8992b3238b5233a4315180c5f84fd2668fc4741ccc6b0243e7d7e29dc",
        "p": "R",
        "dup": false
      },
      {
        "h": "a15be680f156f7f4bac1d4bd0ab62bc3a52b6a8f7326f5ff0675835cbb46f237",
        "p": "L",
        "dup": false
      },
      {
        "h": "887ffb4a6b1b2ad654719f584ef2ae9d773feb0d0403ef2dafce96bcf325869b",
        "p": "R",
        "dup": false
      }
    ],
    "chainRef": null
  },
  "beanDay": {
    "date": "2026-10-26",
    "leafCount": 6,
    "credit": 678,
    "debit": 678,
    "balanced": true,
    "merkleRoot": "b50190265f8d8fec962d355964295283964efd3b8e2e2a9b6f018d999dbe82a4",
    "prevRoot": "d58f6762dde5a1ebba5dd0bc0954fbad829756006ea6587a5391cbcfeeaf35fc"
  },
  "settlement": {
    "id": 1,
    "period": "2026-10-W43",
    "orderCount": 1,
    "total": "278.00",
    "totalCents": 27800,
    "fulfill": "161.24",
    "service": "33.36",
    "promoter": "12.90",
    "beanbudget": "13.90",
    "retained": "56.60",
    "cents": {
      "total": 27800,
      "fulfill": 16124,
      "service": 3336,
      "promoter": 1290,
      "beanbudget": 1390,
      "retained": 5660
    },
    "status": 0,
    "code": "d58f6762dde5a1ebba5dd0bc0954fbad829756006ea6587a5391cbcfeeaf35fc"
  },
  "vc": {
    "did": "did:cn:wl:u47groy2qa3juz62pylyy4cj5m",
    "scope": "travel",
    "claims": {},
    "kid": "did:cn:wl:issuer-main#key-1"
  },
  "chain": {
    "current": {
      "provider": "noop",
      "label": "未接入（本地存证）",
      "mode": "noop",
      "capabilities": {
        "anchor": false,
        "queryByRoot": false,
        "assets": false,
        "did": false
      }
    },
    "providers": [
      {
        "id": "noop",
        "label": "未接入（本地存证）",
        "docs": "配置 CHAIN_PROVIDER 与对应凭据后自动切换；缺凭据期间批次停在「已打包·待锚定」",
        "capabilities": {
          "anchor": false,
          "queryByRoot": false,
          "assets": false,
          "did": false
        },
        "mode": "noop"
      },
      {
        "id": "chaingen",
        "label": "链数根（上海数据集团 · 联盟链）",
        "docs": "文旅票根/一网可信场景；只做存证锚定，不对个人发行资产",
        "capabilities": {
          "anchor": true,
          "queryByRoot": true,
          "assets": false,
          "did": true
        },
        "mode": "noop"
      },
      {
        "id": "tbaas",
        "label": "腾讯云 TBaaS / 至信链",
        "docs": "需已部署落根合约（默认 writeRoot）；资产发行需另配 TBAAS_MINT_FUNC / TBAAS_NFT_CONTRACT",
        "capabilities": {
          "anchor": true,
          "queryByRoot": false,
          "assets": true,
          "did": false
        },
        "mode": "noop"
      },
      {
        "id": "antchain",
        "label": "蚂蚁链 AntChain / 鲸探",
        "docs": "存证走合约/存证服务；藏品与徽章走数字资产服务（鲸探需资质+内容审核+服务商接入）",
        "capabilities": {
          "anchor": true,
          "queryByRoot": false,
          "assets": true,
          "did": true
        },
        "mode": "noop"
      },
      {
        "id": "evm",
        "label": "通用 EVM 链（Polygon / Base / BNB / 自建）",
        "docs": "需托管签名服务（relayer）。存证把 Merkle 根写进交易 input data；资产用 ERC-1155",
        "capabilities": {
          "anchor": true,
          "queryByRoot": false,
          "assets": true,
          "did": true
        },
        "mode": "noop"
      }
    ]
  },
  "events": [
    {
      "type": "bean_grant",
      "count": 2
    },
    {
      "type": "pass_issue",
      "count": 2
    },
    {
      "type": "refund",
      "count": 2
    },
    {
      "type": "bean_deduct",
      "count": 1
    },
    {
      "type": "order",
      "count": 1
    },
    {
      "type": "pass_verify",
      "count": 1
    },
    {
      "type": "settlement",
      "count": 1
    }
  ],
  "totals": {
    "events": 10,
    "types": 7
  }
};
