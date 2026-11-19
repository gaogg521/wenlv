# 商户端权限与到单提醒 · 证据目录（M-11）

隔离库 `wanderlust_qa_mn` + 隔离服务 18240。mini-a 模拟器 390px；mini-b 模拟器 320px（IDE 记忆了上轮自定义机型；验收规范允许 320，390 下同一脚本可复拍）。
截图由走查脚本直调**真实代码路径**产生（`test/walk-mn-mini-b.mjs` / `walk-mn-mini-a.mjs` / `walk-mn-pc.mjs`），无摆拍弹窗：确认弹窗全部来自真实的 `confirmPriceChange` / `staffApply` / `confirmChange` 代码（拍完即取消，不产生写库；改价确认截图中的团期价格保持原值）。

## mini-b/（老板 · 店长 · 核销员三套）

| 文件 | 证明 |
|---|---|
| manager-workbench-guide | M-02：店长首次进工作台的提醒引导弹窗（可跳过） |
| manager-workbench-statusbar | M-09：工作台顶部提醒状态条（与「我的」同源） |
| manager-workbench-neworder-banner | M-02：30s 轮询发现新支付订单后的顶部提示条（🔔 有 1 笔新支付订单 · 忽略/查看），订单 tab 红点同屏（320px 下为 8px 小点）；数据层旁证 poll 直查 newPaid=1。复跑 = test/walk-mn-banner.mjs |
| manager-me-notify-panel | M-02：三个偏好开关 + 状态行（店长默认开） |
| manager-supply | M-01：店长改价入口可见（role>=2） |
| manager-supply-price-confirm-reason | M-12/M-01：改价确认（旧→新，价差超 ±30% 强制填原因）——真实 `confirmPriceChange` 触发 |
| manager-supply-pricechange | M-07：团期卡「最近改价：谁 · 几点 · 旧→新」 |
| boss-workbench / boss-me / boss-me-notify-panel-on | M-02/M-09：老板默认全开 |
| boss-me-staff-list | M-06：员工列表带加入时间 |
| boss-me-staff-change-confirm | M-12/M-06：改岗确认（旧岗位→新岗位，立即生效说明）——真实 `staffApply` 触发 |
| boss-me-staff-disable-reason | A+：停用员工必须填原因 |
| verifier-workbench | M-02/M-09：核销员工作台（无状态条红点噪音） |
| verifier-supply-readonly | M-01/A-33：核销员库存只读/无权限（1003 按「暂无权限」呈现，无重试） |
| verifier-me-notify-panel-off | M-02：核销员默认关 |

## mini-a/（游客端）

| 文件 | 证明 |
|---|---|
| orders-page1 / orders-page2-loadmore | T-01：55 单夹具分页（总数提示 + 触底加载第 2 页） |
| bean-ledger-more | T-01：旅豆流水「查看更多」+ 总数 |
| order-detail-t03 | T-03：单号复制 chip / 联系客服按钮 / 再次预订 |
| square-t06 | T-06：笔记广场标题（截图辅助；断言在 json 与分享配置检查） |

## pc/（D-01 / D-02 / M-12）

| 文件 | 证明 |
|---|---|
| pc-orders-filter-kept | D-01：订单筛选 hash 持久化（切页返回还在） |
| pc-products-filter-kept | D-01：商品筛选 sessionStorage 持久化 + 重置按钮 |
| pc-input-constraints | D-02：金额输入 min/step 约束 |
| pc-uiconfirm-toggle-product | M-12：商品上下架统一确认（点取消不提交） |
| pc-uiconfirm-gen-settlements | M-12：生成结算单 A+ 确认（必填原因） |
| pc-copy-chip-orders | D-05：订单号一键复制 chip |

## 复跑方式

```bash
# 隔离库 + 服务（PORT=18240）就绪后（夹具务必在 test:db 全绿之后再插，避免污染选单类断言）：
mysql -uroot -proot wanderlust_qa_mn < api/scripts/mn-fixtures.sql  # 库名按实际隔离库调整
cd api && DB_NAME=wanderlust_qa_mn PORT=18240 API_BASE=http://127.0.0.1:18240 node test/walk-mn-mini-b.mjs docs/商户端权限与到单提醒-证据/mini-b
# mini-a / pc 同理（模拟器 auto-port 9421/9422；PC 用系统 Chrome/Edge headless 连 18240/admin-ui）
```
