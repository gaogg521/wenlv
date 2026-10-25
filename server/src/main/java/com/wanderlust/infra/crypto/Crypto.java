package com.wanderlust.infra.crypto;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 开发期加密：AES-256-GCM（JDK 自带）+ HMAC-SHA256 检索列。
 * 生产替换为国密 SM4/HMAC-SM3（接入 BouncyCastle 或硬件加密机），接口签名不变。
 * 密钥来源：环境变量 WL_CRYPTO_KEY（hex 32 字节）；缺省用开发密钥并打警告。
 */
public final class Crypto {

    private final byte[] key;
    private final SecureRandom rnd = new SecureRandom();

    public Crypto() {
        String hex = System.getenv("WL_CRYPTO_KEY");
        byte[] k;
        if (hex != null && hex.length() == 64) {
            k = new byte[32];
            for (int i = 0; i < 32; i++) k[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        } else {
            System.err.println("[crypto] WL_CRYPTO_KEY not set, using DEV key (never in production)");
            try { // 开发密钥 = 固定种子的 SHA-256（合法 32 字节 AES-256 key）
                k = java.security.MessageDigest.getInstance("SHA-256")
                        .digest("wanderlust-dev-seed-2026".getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        this.key = k;
    }

    /** 加密为 base64(iv + cipher)，可直接存 VARBINARY（经 base64 文本便于调试） */
    public String encrypt(String plain) {
        try {
            byte[] iv = new byte[12];
            rnd.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("encrypt failed", e);
        }
    }

    public String decrypt(String base64) {
        try {
            byte[] all = Base64.getDecoder().decode(base64);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(128, all, 0, 12));
            byte[] pt = cipher.doFinal(all, 12, all.length - 12);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("decrypt failed", e);
        }
    }

    /** 检索用确定性 HMAC（手机号/身份证查重列） */
    public String hmac(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            byte[] out = mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : out) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("hmac failed", e);
        }
    }
}
