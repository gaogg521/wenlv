# wanderlust 小程序 CLI 调试 · AI 交接手册

> 面向：任何要接手 `wanderlust` 的 AI Agent / 开发者。
> 目的：**别再花两小时重复踩同样的五个坑**。
> 最后验证：2026-10-25 21:0x，冷启动连跑两遍全绿。

---

## 0. 一句话结论

调试入口**只有一条**，不要发明第二条：

```bash
bash C:/Users/allenzhao/Desktop/文旅项目/wanderlust/debug-cli.sh
```

它做四件事：验登录态 → `close` 后 `auto` 开自动化通道(9421) → 逐页检查 7 个页面 → 跑黄金链路。
**不要用 `cli preview` 当调试入口**（走的是上传编译管线，本项目在该管线报 opaque 的 code 10，见 §5）。

---

## 1. 环境事实（换机器必须重新核对这 6 条）

| 项 | 值 | 备注 |
|---|---|---|
| 开发者工具 CLI | `D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` | **装在 D 盘**，不是 C 盘默认路径 |
| 工具版本 | 3.17.5 | `mini.systemInfo()` 回报 `devtools 3.17.5` |
| 服务端口 | 已开启 | `cli islogin` 能返回 `{"login":true}` 即为通 |
| 登录态 | 已登录 | 未登录时先 `cli.bat login`，终端出二维码 |
| Node | v22.22.2 / npm 10.9.7 | 脚本是 `.mjs` + top-level await，需 Node ≥16 |
| Shell | Git Bash (MSYS) | **这是坑 #2 的根源** |

### 工程结构

| 路径 | 是什么 | 能否预览/上传 |
|---|---|---|
| `mini-a/` | 正式小程序，appid `wx39208e393c439be5` | 可（但见 §5） |
| `mini-b/` | appid `touristappid` 测试号 | **不可**，预览必报「不存在此 AppID」 |
| `api/` | 后端 + 全部自动化脚本（`api/test/automator-*.mjs`） | — |
| `admin-web/` `server/` | Next 管理端 / Java 后端 | — |

关键：`automator-*.mjs` 里连的是 `ws://127.0.0.1:9421`，**不是** `automator.launch()`。

---

## 2. 手工三步（脚本坏了就照这个复原）

```bash
CLI="/d/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
MINI="C:/Users/allenzhao/Desktop/文旅项目/wanderlust/mini-a"   # 必须是 C:/ 形式

"$CLI" islogin                                  # 1. 端口 + 登录态
"$CLI" close --project "$MINI"                  # 2. 先关，避免半死会话
"$CLI" auto --project "$MINI" --auto-port 9421  # 3. 开自动化通道

cd C:/Users/allenzhao/Desktop/文旅项目/wanderlust/api
MSYS_NO_PATHCONV=1 node test/automator-check.mjs "$MINI" ./automator-shots-cli \
  /pages/home/index /pages/tour-list/index /pages/shop/index /pages/bean/index /pages/me/index \
  /package-order/pages/orders/index /package-tour/pages/detail/index
MSYS_NO_PATHCONV=1 node test/automator-mini-a-flow.mjs
```

期望输出：每页一行 `[auto] OK <path> -> <path>`；首页断言 `卡片数: 3`、`首个价格: ¥298`；
链路末尾 `[flow] FLOW DONE`，并产出 4 张 `flow-*.png`。

---

## 3. 五个坑（按"浪费时间的概率"排序）

| # | 症状（看起来像什么） | 真实原因 | 判据 / 修法 |
|---|---|---|---|
| 1 | 「未找到 CLI / 请先安装微信开发者工具」 | 工具装在 **D 盘**，所有文档和默认探测只查 C 盘 | 探测时自己加 D 盘候选；`ls "/d/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"` |
| 2 | 页面全红，报 `Uncaught [object Object]`（**像小程序崩了**） | Git Bash 把 `/pages/home/index` 改写成 `C:/.../PortableGit/pages/home/index` | 所有 node 调用前加 **`MSYS_NO_PATHCONV=1`**；报错里出现 `PortableGit` 就是这条 |
| 3 | 连上了，但每条命令 `timeout waiting for automator response` | 同一项目**重复 `auto`**，留下半死会话 | 每次 `auto` 前先 `close --project`，隔 2s |
| 4 | 报 `getPageMetaByWebviewId(...) is null`，**之后整条通道失联、后面全红** | 工具冷启动时模拟器还没出首屏，此时 `reLaunch` 会把会话打崩 | 连上后轮询 `mini.currentPage()` 直到有 `path` 再操作（**等条件，不等时间**）；已在两个脚本内实现 |
| 5 | 「不存在此 AppID」 | 调的是 `mini-b`（touristappid） | 调试只认 `mini-a` |
| 6 | 脚本打印一串「等待自动化通道…」后 `无法连接自动化端口`，退出码 1 | 冷启动时自动化端口可能要 **30s+** 才可用；原脚本只重试 10 次 × 1.5s = 15s，不够 | 重试预算放到 **40 次 × 1s**；**不要**用 TCP 探活替代（见下） |

### 还有一条反模式（我踩过，别再踩）

**不要用 TCP 探活自动化端口。** 该通道是单客户端语义，裸 `net.connect` 探一次就会把通道搅乱（表现为随后连上但命令全超时）。
要等就"真连一次并等着"，别在外部探测。

**也不要用固定 `sleep` 赌编译完成。** 冷启动耗时随机器负载波动，`sleep 6` 时好时坏——这正是"以前有时行有时不行"的根源。

**正确做法是"重试预算"**：连接失败就等 1s 再连，预算 40s（覆盖最慢的冷启动）；连上之后等首屏出来再操作。
两处预算都在脚本里，调参数只调这两个数，不要在外面加 `sleep`。

---

## 4. 配置审计结论：**你的开发者工具配置没有问题**

对 `mini-a/project.config.json` 逐项核对，结论：

- ✅ `appid` 真实、`compileType: miniprogram`、无 `miniprogramRoot`（项目根即小程序根，正确）
- ✅ `sitemap.json` 存在，`packOptions` 无异常忽略规则
- ✅ `urlCheck: false` 是本地开发正常做法（**但记住：真机/体验版会校验域名，必须走已备案 HTTPS 白名单**）
- ✅ `service port` 已开、账号已登录 —— 这两条是 CLI 的硬前提，你本来就满足

做过两次**对照实验**，证明配置不是 `preview` 失败的原因：

| 实验 | 改动 | 结果 |
|---|---|---|
| A | `libVersion: 3.0.0 → 3.17.5`（与 `project.private.config.json` 对齐） | 仍 code 10，**非原因** |
| B | `uploadWithSourceMap: true → false` | 仍 code 10，**非原因**（已还原为 true） |

### 唯一建议修的不一致

`project.config.json` 原为 `libVersion: 3.0.0`，而 `project.private.config.json` 是 `3.17.5`（私有配置优先级更高）。
**两个文件不同步，会让不同机器跑在不同基础库上——典型症状是"我这能跑、他那不行"。**
已统一为 `3.17.5`。今后请保持两处一致。

另注：该目录**不是 git 仓库**、无 `.gitignore`。若日后纳入版本管理，`project.private.config.json` 应进 `.gitignore`（它是个人的、含本机差异的配置）。

---

## 5. 已知未解：`cli preview` 真机预览失败

```
× compile_start
code: 10, message: 'Error: 错误 undefined (code 10)'
```

**已排除**（都做过实验，不是猜测）：

- 服务端口、登录态、GUI 进程状态（`quit` 后全新启动一样失败）
- 编译缓存（`cli cache --clean compile`）、文件监听（`cli reset-fileutils`）
- QR 输出路径/格式（`--qr-output` 各种组合都试过，`--qr-format terminal` 一样失败）
- `libVersion`、`uploadWithSourceMap`（见 §4 实验 A/B）
- 自动化窗口占用（`close` 后再 preview 仍失败）
- 代码本身编译不过（**模拟器同项目编译完全正常，7 页全部渲染**）

**关键对照**：`mini-b`（touristappid）在 **Preview 阶段**报出清晰错误「不存在此 AppID」，
说明 `mini-a` 的失败发生在**更早的预览编译环节**，与 appid 权限无关。

**下一步（二选一）**：

1. 在 GUI 里对 `mini-a` 点一次「预览」——CLI 把 GUI 的错误详情吞成了 code 10，GUI 弹窗会显示真实原因
2. 改走 `miniprogram-ci`（`npm i -g miniprogram-ci`）：不依赖 GUI、报错带文件行号，适合 CI 化上传。
   需要 mp 后台「开发管理 → 开发设置 → 小程序代码上传」下载上传密钥，并配置 IP 白名单

> 影响面：**不影响日常调试**（调试走 `auto` + automator），只影响"扫码真机看效果"和"上传体验版"。

---

## 6. 本次改动的文件

| 文件 | 改动 | 原因 |
|---|---|---|
| `wanderlust/debug-cli.sh` | **新增**，一键脚本 | 把环境差异、顺序依赖、exit code 汇总固化下来 |
| `api/test/automator-check.mjs` | ① 连接重试 10×1.5s → **40×1s**；② 连上后增加"等首屏"轮询 | 修坑 #6（连不上）与坑 #4（冷启动崩会话），这是间歇性全红的真因 |
| `api/test/automator-mini-a-flow.mjs` | ① 增加连接重试（原为裸 connect，无重试）；② 同上"等首屏"轮询 | 同上；原先它只是因为跑在后面"恰好"连上 |
| `mini-a/project.config.json` | `libVersion` 3.0.0 → 3.17.5 | 消除与 private 配置的不一致 |

---

## 7. 验证记录

| 时间 | 动作 | 结果 |
|---|---|---|
| 21:0x 第 1 次 | `bash debug-cli.sh`（冷启动） | 逐页 7/7 OK + `FLOW DONE` + 脚本判定「调试通过」 |
| 21:0x 第 2 次 | 同上，紧接着再跑 | 同上（可重复性验证） |
| 21:1x | 改 `libVersion` 后重跑 | 逐页挂（exit=1）、链路过 —— 暴露坑 #6 连接预算不足 |
| 21:1x | 修连接重试后再连跑 **2 次** | 两次都是 7/7 OK + `FLOW DONE` + 「调试通过」 |
| — | 截图 | `api/automator-shots-cli/`（逐页 8 张）、`api/automator-shots/`（链路 4 张） |

---
## 8.wanderlust 小程序 CLI 调试（2026-10-25 打通经验参考）
**一键命令**：`bash C:/Users/allenzhao/Desktop/文旅项目/wanderlust/debug-cli.sh`（连跑两遍全绿：7 页逐页检查 + 黄金链路）
- 结构：`wanderlust/mini-a` = 正式端（appid `wx39208e393c439be5`）；`mini-b` = touristappid 测试号（只能模拟器）；`api` = 后端 + 自动化脚本（`api/test/automator-*.mjs`，连 `ws://127.0.0.1:9421`）。
- **IDE 装在 D 盘**：`D:/Program Files (x86)\Tencent\微信web开发者工具\cli.bat` —— 所有文档/默认探测只查 C 盘，必须自己加 D 盘候选。
- 五个必踩坑（缺一个就"CLI 不行"）：
  1. 路径形式：给 `cli.bat` 传 `pwd -W` 的 `C:/...`，不能传 `/c/...`；
  2. `MSYS_NO_PATHCONV=1`：否则 `node ... /pages/xxx` 被改写成 PortableGit 路径 → 全页 `Uncaught [object Object]`（假失败头号元凶）；
  3. 先 `cli close --project` 再 `cli auto --auto-port 9421`：重复 auto 留半死会话（连上但命令 timeout）；
  4. 连上后**轮询 `currentPage()` 等首屏**再 reLaunch：冷启动直接 reLaunch 会崩会话（`getPageMetaByWebviewId null`）→ 整条通道失联；
  5. 不要用 TCP 探活端口（单客户端通道会被干扰），要等就真连一次。
- `cli preview`（真机）另属上传编译管线，本项目在 compile_start 抛 opaque code 10；调试不要走它，走 `auto` + automator。要 CI 化上传再上 `miniprogram-ci` + 上传密钥。


## 9. 给下一个 AI 的检查清单

1. 先跑 `debug-cli.sh`。**别先读代码、别先改代码。**
2. 失败时按 §3 表格对症状，不要一上来就怀疑"小程序有 bug"——五个坑里四个都是环境/时序问题。
3. 任何"页面全红但报 `[object Object]`"，先查 `MSYS_NO_PATHCONV`。
4. 任何"连上但超时"，先查是不是重复 `auto`。
5. 需要真机验证时，走 §5 的两条路，**别再在 `cli preview` 上反复试参数**——已排除的项不必重测。
6. 改完代码只需重跑 `debug-cli.sh`；若只改了测试脚本、小程序源码字节未变，跑单页冒烟即可。
