# wanderlust-api（生产 API 服务）

Node 18+ · 零框架 · 唯一依赖 mysql2 · 与 `server/`（Java 版）共用同一套库表（V1~V3 迁移）。
已通过 **HTTP 全链路 E2E 38 PASS**（可重复）覆盖：登录→内容填充→归因→下单（豆抵扣/防超卖）→支付回调（幂等）→出票→商户扫码核销（防重放）→完成→返豆（双闸）→佣金→五口径结算→退款全量冲正→参数中心双人复核→账本试算→审计。

## 本机运行

```bash
# 1. 建库 + 迁移（首次；Docker 路径见下）
mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS wanderlust CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
mysql -uroot -proot --default-character-set=utf8mb4 wanderlust < ../server/src/main/resources/db/migration/V1__init_schema.sql
mysql -uroot -proot --default-character-set=utf8mb4 wanderlust < ../server/src/main/resources/db/migration/V2__seed_rule_config.sql
mysql -uroot -proot --default-character-set=utf8mb4 wanderlust < db/migration/V3__admin_user.sql

# 2. 起服务（后台账号自动种入：admin/finance/ops，密码取 ADMIN_INIT_PASSWORD 默认 admin123）
node src/index.mjs
#    → API  http://127.0.0.1:8080
#    → 后台 http://127.0.0.1:8080/admin-ui   （登录 admin / admin123）

# 3. 全链路测试（自动重置数据，可重复）
npm run e2e     # node test/api-e2e.mjs → 38 PASS
```

## 数据边界与多租户（谁看什么）

| 受众 | 入口 | 隔离 |
|---|---|---|
| 内部（运营/财务/审核/风控/SRE） | PC 后台 | RBAC 全量 |
| 城市合伙人 | PC 后台 | **行级隔离**：scope_city（演示账号 city310118/city123，仅见青浦） |
| 商户 | **小程序 B**（不给 PC 后台） | 按门店 merchant_id 天然隔离 |
| 景区/G端/投资人 |  | 无登录只读验证（不暴露用户与金额） |

代码不隔离（SaaS 化前提）；权限=行级 scope；数据库默认共享、大客户 Docker 独立部署（收费档位）。

## Web3 打通（双层口径的产品化落点）
- 用户侧：GET /c/identity 数字身份（凭证+徽章+每单存证流水）→ 小程序 A「我的数字身份」页
- 后台：治理区「存证中心」（批次/Merkle 根/单号验证）
- 对外：GET /open/verify/order/{单号} 公开存证证明（无登录只读）——给景区/政府/投资人的「一网可信」窗口
- 链：Noop 阶段哈希流水实时记录；P1 换链数根适配器即真实上链，接口不变

## 管理平台工作区（一个平台 · 五个工作区，非新端）

侧边栏五区共享登录/RBAC/审计底座：**经营**（驾驶舱/订单/商品团期）· **交易**（结算）· **生态**（商户进件/内容审核/推广服务商/提现审批/协议变更/旅豆预算）· **治理**（参数中心/风控/审计）· **系统**（**运维控制台**：DB延迟/任务心跳/存证队列/账本试算/滞留单 + 日志联查 + 手动执行任务；**功能开关**：端×城市×能力维度灰度，SaaS 化载体）。
基础设施级监控（Grafana/云监控/RDS 控制台）外链不重建；jobs.mjs 心跳写入 sys_job 表供运维页读取。

## 演示内容录入（模拟真实操作，推荐）

```bash
node test/scenario-populate.mjs
```

23 步真实操作剧本：运营登录后台→建商户/线路/商城SKU/团期/预算→开通推广员→游客扫码进店→做任务得豆→下单(豆抵扣)→支付回调→商户扫码核销→观察期返豆计佣→退款冲正→周结算复核→驾驶舱总览。**全程走与后台 SPA / 小程序完全相同的 HTTP 接口**（非直插库），每步打印操作者与动作，录完系统即处于有内容、有订单、有结算的可演示状态。

另有 `db/seed-content.mjs`（空库兜底批量播种，服务启动时自动调用）与 E2E 自带数据三套口径互不冲突。

## 上线清单（按序执行，完成后即为生产）

**A. 内容填充（后台 UI 操作，10–20 分钟）**
0.（可选）跑 `node test/scenario-populate.mjs` 先铺一套演示内容感受流程；正式内容自己录
1. `/admin-ui` 登录 admin → 修改初始密码（改列或后续版本加改密页；当前可 `UPDATE admin_user SET password_hash=…` 生成方式见 src/auth.mjs）
2. 商户：录入名称/城市/收付通二级商户号
3. 商品与团期：标题/分类/价格/名额（tabBar 商城 SKU 同入口）
4. 旅豆预算：建首批批次（总额=已批准营销预算）
5. 推广服务商：给首批导游/店员开通（三档 5%/8%/12%）

**B. 凭据配置（.env，见 .env.example）**
| 变量 | 作用 | 缺失时行为 |
|---|---|---|
| WX_APPID / WX_SECRET | 小程序登录 code2Session | mock openid（联调） |
| WX_MCHID / WX_SERIAL / WX_PRIVATE_KEY_PATH | 微信支付 V3 | MOCK 通道（不收款） |
| WX_PLATFORM_PUBLIC_KEY + 回调验签 | 支付回调验签 | 生产必须配置（当前 devTrusted 仅限内网） |
| WX_NOTIFY_URL | 回调地址 `https://域名/callback/wxpay` | — |
| JWT_SECRET / PASS_SECRET / ADMIN_INIT_PASSWORD | 安全三件套 | 开发默认值（上线必改） |

**C. 部署（两种方式任选）**
```bash
# 方式一：Docker（含 MySQL 8.0 + 自动执行迁移）
cp .env.example .env   # 填入 B 项
docker compose up -d

# 方式二：PM2（已有 MySQL）
pm2 start ecosystem.config.cjs
```

**D. 微信平台配置**
1. 小程序后台：服务器域名 request 合法域名加 `https://你的域名`（须 ICP 备案 + HTTPS）
2. 微信支付商户平台：绑定小程序 AppID、下载 API 证书（apiclient_key.pem）与微信支付公钥
3. 回调地址无需在平台登记（V3 按单传入 notify_url），但必须 HTTPS 且验签开启

**E. 上线前自检**
- [ ] `curl https://域名/c/health` → payMode = WECHAT-PAY-V3
- [ ] 后台改初始密码；JWT_SECRET 已换
- [ ] 小程序真机预览：登录→下单→（真实支付 0.01 元测试单）→核销码出现
- [ ] 回调验签开启（WX_PLATFORM_PUBLIC_KEY 配置，去掉 devTrusted 依赖）
- [ ] `npm run e2e` 在生产库只读跑（参数中心用例会改参——生产验证时跳过第 10 节）

## 生产 TODO（按总方案 §15 P1）
- ✅ 定时任务进程已就绪：`node src/jobs.mjs`（关单/完成/豆过期/存证打包/佣金/周结算 + sys_job 心跳），Docker compose 与 PM2 配置已含 jobs 服务；联调时可在运维控制台手动触发
- ✅ 已补（二期）：商家转账 V3 通道（提现自动打款，MOCK 兜底）、msgSecCheck 机审（POST /c/notes）、存证 Merkle 打包（jobs tickAttest + attest-pack 手动）、豆过期任务、数字身份 /c/identity + 小程序页、迁移清单入运维页
- 待外部凭据/环境：TOTP 二次验证、链数根真实锚定（anchorToChain 接口已留）、商家转账生产凭据
- 收付通“二级商户分账”模式：当前 V3 通道为普通商户模式直收，切电商收付通时替换 jsapiOrder 里的发起方参数即可（状态编排不变）

## 用微信开发者工具打开小程序（模拟器）

1. 下载安装「微信开发者工具」稳定版：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html（Windows 64 位）
2. 打开工具 → 项目 → 导入 → 目录分别选：
   - 游客端：`C:/Users/allenzhao/Desktop/文旅项目/wanderlust/mini-a`
   - 商户端：`C:/Users/allenzhao/Desktop/文旅项目/wanderlust/mini-b`
   - AppID 选「测试号」（或点使用工具自带的测试号）；项目名随意
3. 导入后先确认设置：详情 → 本地设置 → 勾选「不校验合法域名…」（本地接口是 http://127.0.0.1:8080）
4. 左侧即见模拟器界面；游客端 tabBar 5 个（首页/主题游/商城/旅豆/我的）；商户端先在「我的」输入门店 ID（如 1）绑定后使用核销
5. 前置条件：本机 8080 服务在跑（`cd wanderlust/api && node src/index.mjs`）；连不上时小程序自动显示演示兜底数据
6. 真机预览：工具栏「预览」二维码需正式 AppID（`project.config.json` 的 appid 替换后可用）

## 上线合规清单（对照微信平台规范 · 2026-10-25 核订）

**服务类目与资质**（小程序类目按主体资质报备，材料不齐审核必拒）：
- [ ] 主体类型：企业主体（个人主体无法申请任何旅游服务类目，仅有「出境WiFi」例外）
- [ ] 主类目「旅游服务-景区服务」：**免资质**（景点推荐/门票/导览场景适用）
- [ ] 若按「旅游服务-旅行社」报备：需上传《旅行社业务经营许可证》
- [ ] 商城实物 SKU（含食品如阿婆粽/白茶）：报备实物电商 + 上传《食品经营许可证》
- [ ] 营业性演出/剧本娱乐若单独报备：需《营业性演出许可证》或属地文旅部门备案

**用户隐私保护（2023.9 起强制）**：
- [ ] 公众平台 → 设置 → 服务内容声明 → 用户隐私保护指引：**必须先配置并审核通过**，否则手机号快速验证组件、头像昵称等 API 在正式版直接失效
- [ ] 声明收集项：手机号（下单联系）、头像昵称（用户资料）、订单信息；与代码实际收集一致
- [ ] 小程序内「我的-设置与隐私」已接 `wx.openPrivacyContract`

**请求域名白名单**（公众平台 → 开发管理 → 开发设置 → 服务器域名）：
- [ ] request 合法域名：`https://api.<你的域名>`（上线必须 HTTPS）
- [ ] uploadFile/downloadFile 合法域名：同上（头像上传/小程序码）
- [ ] 本地联调才用「不校验合法域名」，**上线版本必须关掉此选项**

**其他平台要求**：
- [ ] tabBar 图标已按规范内置（81×81 PNG <40KB，普通+选中双态 ✓ 已完成）
- [ ] 不得诱导分享/强制分享（分享按钮均为可选能力 ✓）
- [ ] 支付仅走 wx.requestPayment（真实通道），不诱导绕过 ✓
- [ ] UGC（笔记）已接 msgSecCheck 文本机审；图片 mediaCheckAsync 随图片笔记上线（P1）
- [ ] 小程序名称/头像/简介与实际功能一致；类目页面可用性自查
