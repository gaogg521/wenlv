package com.wanderlust.module.attestation;

import java.util.List;

/** P0 占位实现：只打日志，不阻塞业务（总方案 §7.6：工程不等链） */
public class NoopAttestationClient implements AttestationClient {

    @Override
    public void submit(String bizType, String bizRef, String payloadHash) {
        System.out.println("[attest:noop] submit " + bizType + "/" + bizRef + " hash=" + payloadHash);
    }

    @Override
    public String anchorBatch(String bizDate, List<String> payloadHashes) {
        System.out.println("[attest:noop] anchorBatch " + bizDate + " leaves=" + payloadHashes.size());
        return "NOOP";
    }

    @Override
    public VerifyResult verify(String bizType, String bizRef) {
        return new VerifyResult(false, null, null, null, false);
    }
}
