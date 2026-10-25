# wanderlust — 「向往的自由」工程总仓

唯一设计基准：[`../向往的自由-项目总方案-定稿完整版-20261022.md`](../向往的自由-项目总方案-定稿完整版-20261022.md)（V3.1）。
demo（`../向往的自由-原型源码/`）是交互规格与演示产物，**不是代码来源**；其旧术语/五级分润按口径分离表（总方案 §2.5 / D15）仅限演示。

## 仓库结构

| 目录 | 内容 | 本机验证状态（2026-10-23） |
|---|---|---|
| `api/` | **生产 API 服务（Node 18+，唯一依赖 mysql2）**：/c /m /admin /callback 全路由 + 管理后台 SPA + 定时任务 jobs + Docker/PM2 部署件 + 上线清单 | ✅ **HTTP 全链路 E2E 38 PASS（可重复）**；微信支付 V3 通道（填商户凭据即生产，未填=MOCK 联调） |
| `server/` | Java/Spring Boot 3.2 版（同一套库表；团队企业栈选项） | ✅ 领域 E2E 35 PASS + 核心自检 43 PASS；DDL 红线 9 项实测拦截 |
| `mini-a/` | 游客小程序（原生，tabBar 5 含商城·D14，交易闭环齐全） | ✅ 34 文件语法全过：首页/列表/商城/旅豆/我的 + 详情/下单/支付/订单/动态核销码 |
| `admin-web/` | PC 运营后台（Next.js 14 版，团队可选用） | 源码骨架（**运行版后台在 `api/admin/`，随 API 服务直接访问 /admin-ui**） |
| （P1）`mini-b/` | 商户端小程序（核销/库存/对账；`/m` API 已就绪并有 E2E 覆盖） | 待建 |

## 快速验证（本机：MySQL root/root · Node 24 · JDK 17）

```bash
cd api
node src/index.mjs          # 起 API + 管理后台（http://127.0.0.1:8080/admin-ui，admin/admin123）
npm run e2e                 # HTTP 全链路 38 PASS（自动重置，可重复）
node test/scenario-populate.mjs   # 演示内容录入：23 步真实操作剧本（走真实接口，录完即可演示）
```

上线清单（内容填充 + 凭据 + 部署 + 微信平台配置）：[`api/README.md`](api/README.md)

## Java 版验证（可选；无 Maven 也可跑）

```bash
cd server

# 1. 建库（一次性）
mysql -uroot -proot < <(echo "CREATE DATABASE IF NOT EXISTS wanderlust CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
mysql -uroot -proot --default-character-set=utf8mb4 wanderlust < src/main/resources/db/migration/V1__init_schema.sql
mysql -uroot -proot --default-character-set=utf8mb4 wanderlust < src/main/resources/db/migration/V2__seed_rule_config.sql

# 2. 全链路 E2E（自动重置数据，可重复跑）
java -cp "build/classes;libs/mysql-connector-j-8.4.0.jar" E2eRunner     # 35 PASS

# 3. 领域核心自检（无数据库依赖）
java -cp build/classes VerifyCore                                       # 43 PASS
```

E2E 覆盖：种子 → 归因（首触唯一）→ 下单（豆抵扣即扣·防超卖）→ 支付（幂等·防篡改）→
出票 → 动态码核销（防重放）→ 观察期 → 返豆（预算+总量双闸）→ 佣金（幂等）→
周结算（五口径恒等）→ 退款全量冲正 → 账本试算（Σ贷=Σ借）→ 存证队列 → 审计流。

## 团队侧接入

- 后端：`mvn spring-boot:run`（Flyway 自动迁移；生产 profile 注入 RDS 凭据与 WL_CRYPTO_KEY）
- 小程序：微信开发者工具导入 `mini-a/`（联调地址 `utils/api.js` 的 apiBase）
- 后台：`cd admin-web && npm install && npm run dev`

## 已知坑（踩过的，别再踩）

1. `SENSITIVE` 是 MySQL 保留字——`rule_config.\`sensitive\`` 必须反引号。
2. `settlement.period` 需 VARCHAR(12)（`2026-10-W43` 11 字符）。
3. JDBC URL 用 `characterEncoding=UTF-8`（驱动自动映射 utf8mb4，写 utf8mb4 会连接失败）。
4. `wl://v/...` 二维码 split("/") 得 6 段（双斜杠产生空段）。
5. MySQL `BIGINT UNSIGNED` 经 JDBC getObject 返回 BigInteger——一律 `((Number)x).longValue()`。
6. 虚拟科目（平台抵扣池/预算池）用哨兵 user_id 建真实行，禁止"约定 id=1/9"（会与真实账户自增 id 撞号）。

## 下一步（按总方案 §15）

- server：AuthController（wx.login→JWT）/ OrdersController+收付通 channel / VerifyController 商户端扫码 / beanWorker 定时任务
- mini-b（P1）：10 页，首屏扫码核销
- 存证 P1 切链数根真实适配器（接口不变，替换 NoopAttestationClient）
