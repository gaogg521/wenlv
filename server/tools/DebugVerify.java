import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.db.Db;
import com.wanderlust.module.order.OrderService;
import com.wanderlust.module.pass.PassCodeUtil;
import com.wanderlust.module.pass.PassService;

public class DebugVerify {
    public static void main(String[] a) throws Exception {
        Db db = new Db("127.0.0.1", 3306, "wanderlust", "root", "root");
        ConfigService cfg = new ConfigService();
        OrderService orders = new OrderService(db, cfg);
        PassCodeUtil pc = new PassCodeUtil("e2e-secret-key");
        PassService passes = new PassService(db, orders, pc, cfg);
        var row = db.queryOne("SELECT id FROM travel_pass ORDER BY id DESC LIMIT 1");
        long passId = ((Number) row.get("id")).longValue();
        String qr = passes.currentQrPayload(passId);
        System.out.println("passId=" + passId + " qr=" + qr);
        PassService.VerifyResult v = passes.verifyScan(1L, 9527L, qr, "310118");
        System.out.println("ok=" + v.ok + " reason=" + v.reason);
    }
}
