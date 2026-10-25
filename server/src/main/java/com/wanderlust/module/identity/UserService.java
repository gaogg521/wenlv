package com.wanderlust.module.identity;

import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.crypto.Crypto;
import com.wanderlust.infra.db.Db;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/** 用户域：登录绑定、旅豆户开立、会员等级计算（成长值=已核销金额+CS×10） */
public class UserService {

    public static final int GROWTH_ORDER_VERIFIED = 1;
    public static final int GROWTH_CS_MONTHLY = 2;
    public static final int GROWTH_REFUND_CLAWBACK = 3;
    public static final int GROWTH_ANNUAL_RESET = 4;

    private final Db db;
    private final Crypto crypto;
    private final ConfigService cfg;

    public UserService(Db db, Crypto crypto, ConfigService cfg) {
        this.db = db;
        this.crypto = crypto;
        this.cfg = cfg;
    }

    /** 登录/注册：按 openid/unionid upsert，返回 user_id；新用户同事务开旅豆户 */
    public long loginOrCreate(String unionid, String miniAOpenid, String mobile) {
        Map<String, Object> exist = db.queryOne(
                "SELECT id FROM user_account WHERE mini_a_openid = ? OR (unionid IS NOT NULL AND unionid = ?)",
                miniAOpenid, unionid);
        if (exist != null) {
            long uid = ((Number) exist.get("id")).longValue();
            if (mobile != null) bindMobile(uid, mobile);
            return uid;
        }
        return db.tx(c -> {
            long id = db.insertReturnId(c,
                    "INSERT INTO user_account (unionid, mini_a_openid, mobile_enc, mobile_hmac, nickname) "
                            + "VALUES (?,?,?,?,?)",
                    unionid, miniAOpenid,
                    mobile != null ? crypto.encrypt(mobile) : null,
                    mobile != null ? crypto.hmac(mobile) : null,
                    "旅友" + String.format("%06d", System.currentTimeMillis() % 1_000_000));
            db.update(c, "INSERT INTO bean_account (user_id) VALUES (?)", id);
            return id;
        });
    }

    public void bindMobile(long uid, String mobile) {
        db.update("UPDATE user_account SET mobile_enc = ?, mobile_hmac = ? WHERE id = ?",
                crypto.encrypt(mobile), crypto.hmac(mobile), uid);
    }

    /** 展示口径：手机号脱敏（后端返回即脱敏——总方案 §12） */
    public String maskedMobile(long uid) {
        Map<String, Object> m = db.queryOne("SELECT mobile_enc FROM user_account WHERE id = ?", uid);
        if (m == null || m.get("mobile_enc") == null) return null;
        String base64 = new String((byte[]) m.get("mobile_enc"), StandardCharsets.UTF_8);
        String plain = crypto.decrypt(base64);
        return plain.length() >= 11 ? plain.substring(0, 3) + "****" + plain.substring(7) : plain;
    }

    public int memberLevel(long uid) {
        Map<String, Object> m = db.queryOne("SELECT member_level FROM user_account WHERE id = ?", uid);
        return m == null ? 1 : ((Number) m.get("member_level")).intValue();
    }

    public long growthValue(long uid) {
        Map<String, Object> m = db.queryOne("SELECT growth_value FROM user_account WHERE id = ?", uid);
        return m == null ? 0 : ((Number) m.get("growth_value")).longValue();
    }

    /** 成长值变动（唯一入口）：同事务更新余额+流水+等级 */
    public long addGrowth(long uid, long delta, int bizType, String bizRef) {
        return db.tx(c -> {
            db.update(c, "UPDATE user_account SET growth_value = growth_value + ? WHERE id = ?", delta, uid);
            long after = ((Number) db.queryOne(c,
                    "SELECT growth_value v FROM user_account WHERE id = ?", uid).get("v")).longValue();
            db.update(c, "INSERT INTO user_growth_log (user_id, delta, biz_type, biz_ref, after_val) VALUES (?,?,?,?,?)",
                    uid, delta, bizType, bizRef, after);
            db.update(c, "UPDATE user_account SET member_level = ? WHERE id = ?", levelOf(after), uid);
            return after;
        });
    }

    private int levelOf(long growth) {
        long[] th = cfg.getLongArray("member.level.thresholds");
        int level = 1;
        for (int i = 0; i < th.length; i++) if (growth >= th[i]) level = i + 1;
        return level;
    }
}
