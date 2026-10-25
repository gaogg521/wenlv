package com.wanderlust.module.attestation;

import java.util.List;

/**
 * 存证客户端接口（总方案 §7.6）。
 * P0 用 Noop 实现（工程不等链）；P1 切链数根真实适配器 —— 接口不变。
 */
public interface AttestationClient {

    /** 提交一个待锚定事件（业务事务提交后异步调用，失败只告警不阻塞业务） */
    void submit(String bizType, String bizRef, String payloadHash);

    /**
     * 将一批事件哈希打包成 Merkle 根并上链。
     * @return 链上存证编号（链数根 tx ref）；Noop 实现返回 "NOOP"
     */
    String anchorBatch(String bizDate, List<String> payloadHashes);

    /** 验证：输入业务单号，返回链上锚定信息与本地哈希比对结果 */
    VerifyResult verify(String bizType, String bizRef);

    record VerifyResult(boolean anchored, String merkleRoot, String chainTxRef,
                        String localHash, boolean match) { }
}
