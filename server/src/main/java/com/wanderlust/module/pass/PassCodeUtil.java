package com.wanderlust.module.pass;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;

/**
 * 动态核销码（总方案 §7.3 核销时序）。
 *
 * 码 = HMAC-SHA256(passId, windowNo, 服务端密钥) 截断；
 * 二维码内容 wl://v/{passId}/{windowNo}/{sig}；
 * 服务端验证三件事：窗口有效（±1 容忍时钟漂移）、HMAC 正确、pass_code 无 consumed_at。
 * 防重放最终防线是 pass_code(pass_id, window_no) 唯一约束 —— 本类负责生成与验签。
 */
public final class PassCodeUtil {

    private static final char[] HEX = "0123456789abcdef".toCharArray();
    /** 展示签名长度（截断到 8 hex = 32bit，二维码里再放全量 16 hex） */
    public static final int SIG_SHORT = 8;
    public static final int SIG_FULL = 16;

    private final byte[] secret;

    public PassCodeUtil(String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /** 窗口序号：60s 一窗（窗口秒数由参数中心 pass.code_window 下发） */
    public static long windowOf(long epochSecond, int windowSeconds) {
        return epochSecond / windowSeconds;
    }

    public String sign(long passId, long windowNo) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] out = mac.doFinal((passId + ":" + windowNo).getBytes(StandardCharsets.UTF_8));
            return toHex(out, SIG_FULL);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    /** 二维码内容 */
    public String qrPayload(long passId, long windowNo) {
        return "wl://v/" + passId + "/" + windowNo + "/" + sign(passId, windowNo);
    }

    /** 6 位数字展示码（同窗口同码；商户断网时可人工输入比对） */
    public String displayCode(long passId, long windowNo) {
        String sig = sign(passId, windowNo);
        int v = Integer.parseUnsignedInt(sig.substring(0, 4), 16); // 16bit
        return String.format("%06d", v % 1_000_000);
    }

    /** 验签：容忍 ±1 窗口（手机与服务端时钟漂移），返回命中的窗口；不匹配返回 -1 */
    public long verify(long passId, long windowNo, String sig) {
        for (long w = windowNo - 1; w <= windowNo + 1; w++) {
            if (w < 0) continue;
            if (sign(passId, w).equals(sig)) return w;
        }
        return -1;
    }

    private static String toHex(byte[] bytes, int len) {
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < bytes.length && sb.length() < len; i++) {
            sb.append(HEX[(bytes[i] >> 4) & 0xF]).append(HEX[bytes[i] & 0xF]);
        }
        return sb.toString();
    }
}
