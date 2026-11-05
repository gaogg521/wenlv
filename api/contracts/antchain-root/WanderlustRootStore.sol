// SPDX-License-Identifier: MIT
// 向往的自由 · 存证落根合约（蚂蚁链开放联盟链 / Solidity）
//
// 设计原则（改之前先读）：
//   1. 链上只放"指纹"，不放业务数据、不放个人信息。四个字段：根 / 前根 / 业务日 / 叶子数。
//   2. 只写不删、不覆盖。同一枚根重复写入是幂等的（返回 false、不重发事件），不同内容写同一枚根不可能发生
//      —— 根是内容派生值，内容变了根就变。
//   3. 合约一旦部署不可修改，所以这里**不做业务逻辑**：没有费率、没有权限矩阵、没有可升级代理。
//      越薄越安全。要改规则就换合约地址，历史批次仍指向旧合约，不破坏已锚定记录。
//   4. 写入必须带 seq（单调递增），让外部能按顺序核对"第 N 批 → 第 N+1 批"的前根衔接。
pragma solidity >=0.6.10 <0.9.0;

contract WanderlustRootStore {
    struct Root {
        bytes32 prevRoot;   // 前一批的根（创世填 0x0）
        uint64  bizDate;    // 业务日 yyyymmdd，如 20261104
        uint32  leafCount;  // 本批叶子数
        uint32  seq;        // 批次序号，从 1 开始，必须连续 +1
        uint64  anchoredAt; // 写入时的区块时间（秒）
    }

    // 蚂蚁链真机教训（两条，都是 msg.sender 是 32 字节账户地址造成的；solc 默认它只有 20 字节、不做清理）：
    //   V1：owner(address) 与 lastSeq(uint32) 同槽打包，owner = msg.sender 把高位字节漏进 lastSeq，
    //       部署后 head().seq 读出 2087900645 而不是 0。→ 存储不打包，lastSeq 用 uint256 独占一槽。
    //   V2：读 owner（address 类型）时 solc 会清成 20 字节，而 msg.sender 仍是 32 字节，"msg.sender == owner" 永远不等，
    //       真机 senderIsOwner() 返回 false，writeRoot 必回滚。→ 不用 address 类型比较身份：
    //       用内联汇编取 caller() 的原始 256 位，以 bytes32 存储并比较（_sender / ownerKey）。
    bytes32 public ownerKey;      // 写入账户的 32 字节原始调用者地址（= 控制台里的"账户地址"）
    uint256 public lastSeq;
    bytes32 public lastRoot;
    uint256 public totalRoots;

    mapping(bytes32 => Root) private roots;

    event RootAnchored(bytes32 indexed root, bytes32 prevRoot, uint64 bizDate, uint32 leafCount, uint32 seq, uint64 at);
    event OwnerChanged(bytes32 indexed from, bytes32 indexed to);

    modifier onlyOwner() {
        require(_sender() == ownerKey, "only owner");
        _;
    }

    /// @dev 原始 256 位调用者。不能写 msg.sender：见文件头 V2 教训（address 类型会被清成 20 字节）。
    function _sender() private view returns (bytes32 s) {
        assembly { s := caller() }
    }

    constructor() public {
        ownerKey = _sender();
    }

    /// @notice 落一枚根。同根重复提交返回 false（幂等），不覆盖、不重发事件。
    /// @dev 前根必须等于上一批的根；序号必须严格 +1。这样"删掉中间一批"会立刻在链上暴露。
    function writeRoot(bytes32 root, bytes32 prevRoot, uint64 bizDate, uint32 leafCount, uint32 seq) public onlyOwner returns (bool) {
        require(root != bytes32(0), "root required");
        require(bizDate >= 20200101 && bizDate <= 29991231, "bad bizDate");
        require(leafCount > 0, "bad leafCount");
        if (roots[root].anchoredAt != 0) return false;          // 幂等：这枚根已经写过了
        require(uint256(seq) == lastSeq + 1,"seq must be lastSeq+1");   // 不许跳号、不许重号
        require(prevRoot == lastRoot, "prevRoot mismatch");     // 前根必须接上，链条不可断

        roots[root] = Root({ prevRoot: prevRoot, bizDate: bizDate, leafCount: leafCount, seq: seq, anchoredAt: uint64(block.timestamp) });
        lastSeq = seq;
        lastRoot = root;
        totalRoots += 1;
        emit RootAnchored(root, prevRoot, bizDate, leafCount, seq, uint64(block.timestamp));
        return true;
    }

    /// @notice 按根查：是否存在、业务日、叶子数、序号、写入时间
    function getRoot(bytes32 root) public view returns (bool exists, uint64 bizDate, uint32 leafCount, uint32 seq, uint64 anchoredAt) {
        Root storage r = roots[root];
        return (r.anchoredAt != 0, r.bizDate, r.leafCount, r.seq, r.anchoredAt);
    }

    /// @notice 按根查前根（外部据此自己往前走，就能验证整条链）
    function prevRootOf(bytes32 root) public view returns (bytes32) {
        return roots[root].prevRoot;
    }

    /// @notice 链头：最新序号与最新根，第三方对比"我手里的批次是不是最新的"
    function head() public view returns (uint32 seq, bytes32 root, uint256 count) {
        return (uint32(lastSeq), lastRoot, totalRoots);
    }

    /// @notice 诊断：调用者是否被识别为 owner。部署后先用它在真机确认 onlyOwner 的比较成立（V2 就是这里返回了 false），再写第一枚根。
    function senderIsOwner() public view returns (bool) {
        return _sender() == ownerKey;
    }

    /// @notice 移交写入权（例如更换服务账号）。历史根不受影响。
    /// @param nextKey 新写入账户的 32 字节地址（控制台里的"账户地址"，64 位 hex），不是 20 字节 address。
    function transferOwnership(bytes32 nextKey) public onlyOwner {
        require(nextKey != bytes32(0), "bad owner");
        emit OwnerChanged(ownerKey, nextKey);
        ownerKey = nextKey;
    }
}
