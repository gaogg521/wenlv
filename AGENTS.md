# 项目约定（AI 开工必读）

1. 先读 `docs/AI交接手册-20261102.md`（当前状态、红线、待办），再读 `README.md`。根目录只留 `README.md`、`CLAUDE.md`、`AGENTS.md`、`WORKBUDDY.md`；**交接/验收/方案/进度/诊断类文档一律创建或移动到 `docs/`（含以后新写的），不要放仓库根目录**。
2. 运行实现只有 `api/`、`api/admin/`、`mini-a/`、`mini-b/`；`server/`、`admin-web/`、`archive/`、原型目录不改业务。
3. 改完必须：`cd api && npm test`；涉及数据库再跑 `DB_NAME=<隔离库> npm run test:db`（需服务在跑、同一 JWT_SECRET）。
4. 红线：小程序界面不出现区块链/虚拟资产用语；游客接口只下发白名单字段；金额存分、比例存 bp、数值走参数中心；迁移只增不改（下一个 V43）；小程序新页面必须登记到 `api/admin/miniapp.js` 的 MINI_MAP。
5. 流程：分支 → PR → 测试全绿后直接合并到 `main`，无需再问负责人；合并前更新交接手册（状态、待办、验证结果）。
