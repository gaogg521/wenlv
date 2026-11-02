# 项目约定（AI 开工必读）

1. 先读 `AI交接手册-20261102.md`（当前状态、红线、待办），再读 `README.md`。
2. 运行实现只有 `api/`、`api/admin/`、`mini-a/`、`mini-b/`；`server/`、`admin-web/`、`archive/`、原型目录不改业务。
3. 改完必须：`cd api && npm test`；涉及数据库再跑 `DB_NAME=<隔离库> npm run test:db`（需服务在跑、同一 JWT_SECRET）。
4. 红线：小程序界面不出现区块链/虚拟资产用语；游客接口只下发白名单字段；金额存分、比例存 bp、数值走参数中心；迁移只增不改（下一个 V32）；小程序新页面必须登记到 `api/admin/miniapp.js` 的 MINI_MAP。
