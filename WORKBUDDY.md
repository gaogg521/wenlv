# 「向往的自由」Web3 文旅项目

> **给 WorkBuddy 新会话的开工说明**：本目录是项目唯一工作区。请把会话工作目录设为本路径
> `C:\Users\allenzhao\Desktop\文旅项目`，然后先读本文件，再读
> `向往的自由-原型源码/README.md` 与 `向往的自由-原型源码/交接与决策记录.md`。

## 一分钟看懂这个项目

「向往的自由」Web3 文旅生态 —— 商业 + 技术双轮的高保真原型。
四端（游客 / 合伙人 / 商户 / 平台运营）共用一个单文件 HTML，业务闭环已打通到分账一级。

## 主开发目录

**`向往的自由-原型源码/`** ← 所有代码改动都在这里

| 路径 | 作用 |
|---|---|
| `src/p1.html … p8*.html` | 13 个组件片段（改这里，**不要改成品 HTML**） |
| `build.py` | 拼装成单文件 `向往的自由-业务系统demo-高保真版.html` |
| `tools/*.js` | 15 套 CDP 自动化验收脚本 |
| `shots_tabs/` 等 | 各轮回归截图 |
| `README.md` | 版本号、验收基线、使用说明 |
| `交接与决策记录.md` | 十九章决策台账，改动前先查历史决策，避免推翻已定结论 |

### 标准工作流
```bash
cd "C:/Users/allenzhao/Desktop/文旅项目/向往的自由-原型源码"
# 1. 改 src/ 下的片段
python build.py                # 重新拼装
node tools/deepscan.js         # 48 子页全量下钻
node tools/crosstrace.js       # 跨端账实一致断言（最重要）
node tools/deadlink.js
node tools/overflow.js
```
脚本以 `__dirname` 自解析路径，工作目录任意，搬移不影响运行。

## 四条不可违背的红线

1. **只改 `src/`，跑 `build.py` 生成成品。** 直接改 HTML 会被下次构建覆盖。
2. **严禁身份自动切换/跳转。** 游客/合伙人/商户/运营四端数据必须互相隔离；商户和合伙人看数据时绝不跳到平台运营端。
3. **同一指标只能有一套数。** 比率必须能指出分子分母；运营端与合伙人端两处分账视图必须同源调用 `splitRowsReal()`。
4. **验收不过不算完成。** deepscan / crosstrace / deadlink / overflow 必须全绿，且产物字节数与 README 记录一致。

## 账实一致是本项目的生命线

「一单 ¥298 怎么分」五项合计恒等，是全项目最强的不变量：

```
298 = 商家结算 + 平台服务费 + 旅豆发行 + 权益预算 + 留存毛利
```
权益核销成本（v1.7 实绩 ¥34,940 ÷ 1,780 单 = 单均 ¥19.63）从**留存毛利**扣，
超支不凭空消失。相关计算层集中在 `src/p4d.html`：
`rightsLineNet()` / `rightsRealized()` / `splitRowsReal()` / `splitRealNote()`。

## wanderlust 小程序（另一条产品线）

`wanderlust/` 是微信小程序工程（`mini-a` 正式端 / `mini-b` 测试号 / `api` 后端 + 自动化脚本）。

**调试只有一条命令**：

```bash
bash C:/Users/allenzhao/Desktop/文旅项目/wanderlust/debug-cli.sh
```

换机器、换 Agent、调不通时，**先读** `wanderlust/CLI调试-AI交接手册.md`：
里面有环境事实表、五个必踩坑（症状→判据→修法）、配置审计结论、已知未解项。
**不要用 `cli preview` 当调试入口**，它走上传编译管线，本项目在该管线报 opaque code 10。

## 记忆与记录

- 工作记忆：`.workbuddy/memory/MEMORY.md`（长期约定）+ `MEMORY-YYYY-MM-DD.md` 式每日日志（只追加）。
- 云端资料库工具**只能新建节点、不能覆盖**，历史版本会堆叠，清理时认版本号。

## 关键链接
- 云端成品（v1.7）：https://www.workbuddy.cn/space/d/sQbdfV8aa1G1Q39h2dRrv2
- 云端源码（v1.7）：https://www.workbuddy.cn/space/d/tyCfE99o4iXFrYrji1a68q
- 商业与技术总体方案：`「向往的自由」Web3 文旅生态商业与技术总体方案1019.docx`