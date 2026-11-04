// SPDX-License-Identifier: MIT
// 向往的自由 · 旅豆链上账本（蚂蚁链开放联盟链 / Solidity）
//
// ============ 合规边界（改代码前先读，这是红线不是建议）============
// 旅豆是**封闭式单用途积分 / 预付权益**，不是虚拟货币、不是代币、不是证券：
//   1. 只有平台托管账户（operator）能发行与扣减。用户**不持私钥**、不签名 —— 一旦让用户自持私钥，
//      性质就从"平台积分账本"变成"自托管资产"，这是监管认定的关键分水岭。
//   2. **没有 transfer / approve / allowance**。用户之间不能互转，不能提现，不能挂单交易。
//      合约里根本不存在转让函数 —— 不是"限制了"，是"没有这条路"。
//   3. 只能单向消耗（抵扣订单、核销权益）。发行量、消耗量、余额全部链上可查，可审计。
//   4. 链上只放**账户键（DID 的哈希）**，不放手机号、姓名、订单明细。
//
// 因此本合约做三件事：发行（mint）、消耗（consume）、按日封账（writeDayRoot）。
// 每笔动作只发事件不写 storage（省燃料、浏览器可查完整流水）；storage 只存余额与当日累计。
pragma solidity >=0.6.10 <0.9.0;

contract WanderlustPoints {
    address public owner;      // 合约所有者（可移交）
    address public operator;   // 唯一可发行/扣减的托管账户（链账户 allenzhao）

    string  public constant name = "Wanderlust Bean";
    string  public constant symbol = "WLBEAN";
    uint8   public constant decimals = 0;   // 旅豆是整数个，没有小数

    uint64  public totalMinted;    // 累计发行（贷）
    uint64  public totalConsumed;  // 累计消耗（借）
    uint64  public totalExpired;   // 累计过期回收（借）

    // 当日累计：写日终根时要求与合约内累计一致，防止"库里算一套、链上另算一套"
    uint64  public dayStamp;       // 当前累计所属业务日 yyyymmdd
    uint64  public dayDebit;       // 当日 Σ借
    uint64  public dayCredit;      // 当日 Σ贷
    uint32  public dayEntries;     // 当日笔数

    uint32  public dayRootSeq;     // 已封账天数
    bytes32 public lastDayRoot;    // 上一日终根（前根衔接，断链立刻暴露）

    mapping(bytes32 => uint64) private balances;

    /// direction: 1=贷(发行/返豆) 2=借(消耗/过期/风控回收)
    event Entry(bytes32 indexed accountKey, uint8 direction, uint64 amount, uint64 afterBalance,
                uint8 bizType, bytes32 bizRef, uint64 bizDate, uint64 at);
    event DayRoot(uint64 indexed bizDate, bytes32 root, bytes32 prevRoot, uint32 leafCount,
                  uint64 debitSum, uint64 creditSum, uint32 seq, uint64 at);
    event OperatorChanged(address indexed from, address indexed to);

    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
        _;
    }

    constructor(address op) public {
        owner = msg.sender;
        operator = op == address(0) ? msg.sender : op;
    }

    // ---------- 账本 ----------

    /**
     * @notice 发行旅豆（消费返豆 / 任务奖励 / 内容奖励）
     * @dev bizType 与库里的 bean_ledger.biz_type 对齐：1 消费返豆 2 任务 3 内容 7 风控
     */
    function mint(bytes32 accountKey, uint64 amount, uint8 bizType, bytes32 bizRef, uint64 bizDate) public onlyOperator returns (uint64) {
        require(accountKey != bytes32(0), "account required");
        require(amount > 0, "amount required");
        _rollDay(bizDate);
        uint64 bal = balances[accountKey] + amount;
        balances[accountKey] = bal;
        totalMinted += amount;
        dayCredit += amount;
        dayEntries += 1;
        emit Entry(accountKey, 1, amount, bal, bizType, bizRef, bizDate, uint64(block.timestamp));
        return bal;
    }

    /**
     * @notice 消耗旅豆（订单抵扣）
     * @dev 余额不足直接 revert —— 链上绝不允许透支，宁可失败也不写错账
     */
    function consume(bytes32 accountKey, uint64 amount, uint8 bizType, bytes32 bizRef, uint64 bizDate) public onlyOperator returns (uint64) {
        require(amount > 0, "amount required");
        require(balances[accountKey] >= amount, "insufficient balance");
        _rollDay(bizDate);
        uint64 bal = balances[accountKey] - amount;
        balances[accountKey] = bal;
        totalConsumed += amount;
        dayDebit += amount;
        dayEntries += 1;
        emit Entry(accountKey, 2, amount, bal, bizType, bizRef, bizDate, uint64(block.timestamp));
        return bal;
    }

    /**
     * @notice 过期 / 风控回收（借方向，但不计入"消耗"）
     */
    function expire(bytes32 accountKey, uint64 amount, bytes32 bizRef, uint64 bizDate) public onlyOperator returns (uint64) {
        require(amount > 0, "amount required");
        require(balances[accountKey] >= amount, "insufficient balance");
        _rollDay(bizDate);
        uint64 bal = balances[accountKey] - amount;
        balances[accountKey] = bal;
        totalExpired += amount;
        dayDebit += amount;
        dayEntries += 1;
        emit Entry(accountKey, 2, amount, bal, 6, bizRef, bizDate, uint64(block.timestamp));
        return bal;
    }

    /**
     * @notice 日终封账：把当天全部流水的 Merkle 根写进链，并把链上累计的借贷与库里的借贷合计对齐
     * @dev 借贷合计对不上就 revert —— 这一条挡住"库里偷偷改了流水、链上却照封"的情况
     */
    function writeDayRoot(uint64 bizDate, bytes32 root, bytes32 prevRoot, uint32 leafCount,
                          uint64 debitSum, uint64 creditSum) public onlyOperator returns (bool) {
        require(root != bytes32(0), "root required");
        require(prevRoot == lastDayRoot, "prevRoot mismatch");
        // 只允许封"当前累计所属日"，且库里给的借贷合计必须与合约内累计一致
        require(bizDate == dayStamp, "bizDate not rolled yet");
        require(debitSum == dayDebit && creditSum == dayCredit, "sum mismatch with on-chain");
        require(leafCount == dayEntries, "leafCount mismatch with on-chain");

        lastDayRoot = root;
        dayRootSeq += 1;
        emit DayRoot(bizDate, root, prevRoot, leafCount, debitSum, creditSum, dayRootSeq, uint64(block.timestamp));
        return true;
    }

    /** 切到下一天（第一笔当日流水时自动调用；也可显式调用，便于 0 流水日也封账） */
    function _rollDay(uint64 bizDate) internal {
        require(bizDate >= 20200101 && bizDate <= 29991231, "bad bizDate");
        if (dayStamp == 0) { dayStamp = bizDate; return; }
        require(bizDate >= dayStamp, "bizDate cannot go back");
        if (bizDate == dayStamp) return;
        dayStamp = bizDate; dayDebit = 0; dayCredit = 0; dayEntries = 0;
    }

    // ---------- 查询（任何人可查，不需要我们的系统）----------

    function balanceOf(bytes32 accountKey) public view returns (uint64) { return balances[accountKey]; }
    function supply() public view returns (uint64 minted, uint64 consumed, uint64 expired, uint64 circulating) {
        return (totalMinted, totalConsumed, totalExpired, totalMinted - totalConsumed - totalExpired);
    }
    function today() public view returns (uint64 bizDate, uint64 debit, uint64 credit, uint32 entries) {
        return (dayStamp, dayDebit, dayCredit, dayEntries);
    }

    // ---------- 治理（只有移交，没有提权）----------

    function transferOperator(address next) public {
        require(msg.sender == owner || msg.sender == operator, "not allowed");
        require(next != address(0), "bad operator");
        emit OperatorChanged(operator, next);
        operator = next;
    }

    // 刻意不实现：transfer / transferFrom / approve / allowance / 任何用户间转账与二级流转。
}
