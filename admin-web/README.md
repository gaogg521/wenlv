# wanderlust-admin（PC 运营后台）

Next.js 14 App Router + AntD 5（总方案 §11）。本目录为源码骨架，团队侧：

```bash
npm install
npm run dev        # http://localhost:3000（API 代理到 127.0.0.1:8080）
```

模块清单（随 P0/P1 逐个补齐页面）：驾驶舱 / 订单 / 商品 / 商户 / 凭证 / **参数中心** /
旅豆预算 / 推广服务商 / 结算复核 / 内容审核 / 风控 / 存证验证 / 系统（账号·RBAC·审计）。

鉴权：账号密码 + TOTP；敏感操作短信二次确认（§7.2）。全部写操作强制原因 + 前后快照入 audit_log。
