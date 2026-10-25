# wanderlust-server

「向往的自由」小程序生态后端 · 第 0 阶段（W1）交付物。
依据《项目总方案（定稿·完整版）V3.1》（`../../向往的自由-项目总方案-定稿完整版-20261022.md`）。

## 当前包含

| 交付物 | 位置 | 状态 |
|---|---|---|
| Flyway V1 全量建表（37 张表，MySQL 8.0+） | `src/main/resources/db/migration/V1__init_schema.sql` | ✅ 本机 MySQL 9.3 实际执行通过 |
| Flyway V2 参数中心种子（34 个 key，§4.1bis 全量） | `V2__seed_rule_config.sql` | ✅ 已入库 |
| 订单状态机（守卫表，唯一写入口） | `module/order/OrderStateMachine.java` | ✅ 自检 10 断言过 |
| 旅豆双分录账本（恒等式/预算红线/无购买枚举） | `module/bean/BeanLedger.java` | ✅ 自检 6 断言过 |
| 动态核销码（HMAC/窗口轮换/±1 容忍） | `module/pass/PassCodeUtil.java` | ✅ 自检 9 断言过 |
| 参数中心（默认值=定稿数字，可覆盖） | `infra/config/ConfigService.java` | ✅ 自检 12 断言过 |
| 存证接口 + Noop 实现（P0 不等链） | `module/attestation/` | ✅ |
| 统一响应与错误码（§7.7 分段） | `common/Result.java` | ✅ |
| Spring Boot 壳 + 健康检查 `GET /c/health` | `Application.java` / `api/` | 编译未跑（本机无 Maven） |

## 本地运行（需要 JDK 17+、Maven、MySQL 8.0+）

```bash
# 1. 建库（Flyway 会自动建表，见 application.yml）
mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS wanderlust CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"

# 2. 起服务（Flyway 自动执行 V1/V2）
mvn spring-boot:run

# 3. 验证
curl http://127.0.0.1:8080/c/health
```

datasource 默认 `root/root`（本机开发验证环境 2026-10-23）；生产 RDS 凭据走环境变量/profile 注入，勿提交。

## 无 Maven 环境的核心逻辑验证（本机已跑通）

```bash
mkdir -p build/classes
javac -encoding UTF-8 -d build/classes $(find src/main/java/com/wanderlust/module src/main/java/com/wanderlust/infra src/main/java/com/wanderlust/common -name "*.java")
javac -encoding UTF-8 -cp build/classes -d build/classes tools/VerifyCore.java
java -cp build/classes VerifyCore     # 43 PASS / 0 FAIL
```

## DDL 红线约束（已在本机 MySQL 实测拦截）

| 约束 | 拦截场景 | 实测 |
|---|---|---|
| `promoter.chk_rate` | 费率突破 12% 封顶（1300bp 拒绝） | ✅ ERROR 3819 |
| `tour_session.chk_quota` | 团期超卖（booked>quota） | ✅ |
| `settlement.chk_identity` | 五口径不守恒（差 1 分也拒） | ✅ |
| `bean_ledger.chk_amt` | 分录金额 ≤0 | ✅ |
| `bean_budget.chk_budget` | 批次预算超发 | ✅ |
| `bean_global_cap.chk_cap` | 全局发行总量超发 | ✅ |
| `bean_account.chk_bal` | 负余额 | ✅ |
| 唯一键 | 幂等键/订单号重复 | ✅ ERROR 1062 |

已知坑（踩过）：`SENSITIVE` 是 MySQL 8.0+ 保留字，`rule_config.sensitive` 列必须反引号；
`settlement.period` 需 VARCHAR(12)（`2026-10-W43` 是 11 字符）。

## 下一步（W1 收尾 → W2）

- [ ] AuthController：wx.login → code2Session → JWT（infra/wx SDK 封装）
- [ ] OrdersController + PaymentService：下单锁团期（条件 UPDATE）→ 收付通统一下单 → 回调幂等
- [ ] VerifyController（商户端扫码）：PassCodeUtil 接入 pass_code 唯一约束消费
- [ ] beanWorker：订单 50 事件 → BeanLedger.grant 落库（含预算/总量校验）→ attest_event
- [ ] mini-a 五页壳（分包结构见总方案 §9：tabBar 5 个，商城一级位 D14）
