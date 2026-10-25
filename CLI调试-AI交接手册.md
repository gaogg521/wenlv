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
  /package-tour/pages/detail/index /package-tour/pages/pay-result/index \
  /package-order/pages/orders/index /package-order/pages/order-detail/index /package-order/pages/pass-code/index \
  /package-content/pages/identity/index /package-content/pages/create/index \
  /package-promo/pages/center/index
MSYS_NO_PATHCONV=1 node test/automator-mini-a-flow.mjs
```

> **页面清单必须覆盖 app.json 里的全部 13 个页面**（主包 5 + 分包 8）。
> 早期版本只列了 7 页，漏掉 `package-content/*` 与 `package-promo/*`，
> 于是"全绿"掩盖了三个页面**根本打不开**的事实（见坑 #7）。

期望输出：每页一行 `[auto] OK <path> -> <path>`；首页断言 `卡片数: 3`、`首个价格: ¥298`；
链路末尾 `[flow] FLOW DONE`，并产出 4 张 `flow-*.png`。

---

## 3. 八个坑（按"浪费时间的概率"排序）

| # | 症状（看起来像什么） | 真实原因 | 判据 / 修法 |
|---|---|---|---|
| 1 | 「未找到 CLI / 请先安装微信开发者工具」 | 工具装在 **D 盘**，所有文档和默认探测只查 C 盘 | 探测时自己加 D 盘候选；`ls "/d/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"` |
| 2 | 页面全红，报 `Uncaught [object Object]`（**像小程序崩了**） | Git Bash 把 `/pages/home/index` 改写成 `C:/.../PortableGit/pages/home/index` | 所有 node 调用前加 **`MSYS_NO_PATHCONV=1`**；报错里出现 `PortableGit` 就是这条 |
| 3 | 连上了，但每条命令 `timeout waiting for automator response` | 同一项目**重复 `auto`**，留下半死会话 | 每次 `auto` 前先 `close --project`，隔 2s |
| 4 | 报 `getPageMetaByWebviewId(...) is null`，**之后整条通道失联、后面全红** | 工具冷启动时模拟器还没出首屏，此时 `reLaunch` 会把会话打崩 | 连上后轮询 `mini.currentPage()` 直到有 `path` 再操作（**等条件，不等时间**）；已在两个脚本内实现 |
| 5 | 「不存在此 AppID」 | 调的是 `mini-b`（touristappid） | 调试只认 `mini-a` |
| 6 | 脚本打印一串「等待自动化通道…」后 `无法连接自动化端口`，退出码 1 | 冷启动时自动化端口可能要 **30s+** 才可用；原脚本只重试 10 次 × 1.5s = 15s，不够 | 重试预算放到 **40 次 × 1s**；**不要**用 TCP 探活替代（见下） |
| 7 | 某个**分包**的页面全部打不开：导航静默超时，`currentPage` 停在原页；控制台只有一句 `Page "xxx" has not been registered yet`；CLI 侧完全没有任何报错 | **该分包 wxml 里有"复杂绑定表达式"，编译失败是静默的**——工具只在「问题」面板记一条，运行时表现为整个分包注册不上 | 见 §3.1，判据是 `__wxAppCode__` 里缺 `package-xxx/` 键 |
| 8 | 按 #7 改完 wxml 后**仍然打不开**，看起来"改了没用" | 分包 wxml 改动后，`close + cache --clean compile + auto` **不一定触发该分包重新编译**（假失败） | 用 `diag-code.mjs` 看 `__wxAppCode__` 是否已含该分包；没变就再触发一次改动/重启工具，别急着改代码 |

### 3.1 坑 #7 的完整机理与已确认的雷区写法

**症状链**：`navigation 无回调/超时` → `currentPage` 不变 → console 只有 `Page "…" has not been registered yet` → 但 `app.json` 路由表里**明明有**这个页面，且访问不存在的页面会 4ms 返回 `is not found`（对照组）。

**判据（一行定位）**：进页面后读运行时注册表

```js
// 在 app service 里执行（脚本 api/test/diag-code.mjs 已封装）
Object.keys(__wxAppCode__).filter(k => k.startsWith('package-'))
// 能打开的分包：导航后出现 package-order/pages/... 等键
// 挂掉的分包：这些键永远不出现 —— 说明该分包代码从未被注入
```

**已实锤的雷区写法**（本机 devtools 3.17.5，全部做过 A/B 复现）：

| 雷区 | 位置 | 报错表现 | 正确写法 |
|---|---|---|---|
| `{{(ov.withdrawable / 100).toFixed(2)}}`（括号算术表达式上链式调用方法） | `package-promo/pages/center/index.wxml` | 整个 `package-promo` 分包注册不上 | 在 JS 里算好：`ov.withdrawableYuan = (v/100).toFixed(2)`，wxml 只写 `{{ov.withdrawableYuan}}` |
| `{{['探索者','旅行家'][d.profile.memberLevel-1]}}`（数组字面量 + 下标表达式） | `package-content/pages/identity/index.wxml` | 整个 `package-content` 分包注册不上 | 在 JS 里映射：`d.profile.levelName = LEVELS[m-1]` |
| `{{item.status===1?'待使用':item.status===2?'已核销':'已作废'}}`（嵌套三元） | 同上 | 同上（与上一条各自独立致命） | 在 JS 里算 `statusText` |

**没有雷区的写法**（已验证安全，可放心用）：单个三元 `{{a?b:c}}`、`{{a||b}}`、`{{item.title || '（无题）'}}`、`{{arr.length}}`、`{{a.b.c}}`、`wx:key="orderNo"`、`wx:key="index"`、自闭合 `<textarea/>`。

> 注意：`{{[10,20,30,40].indexOf(o.status) > -1}}` 在 `package-order/pages/order-detail` 里**能正常工作**，
> 说明"不是所有方法调用都禁止"。**结论只认实测，别按直觉类推；改 wxml 后必须跑 13 页逐页检查。**

**修完的通用口径**：WXML 绑定只做"取值 + 算术 + 单个三元"，任何**格式化 / 映射 / 方法调用**都放 JS 里预计算成字段
（`xxxYuan`、`xxxText`、`levelName`），视图层零硬编码。这条同时也是"数据单一来源"的要求。

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
| A | `libVersion: 3.0.0 → 3.17.5`（与 `project.private.config.json` 对齐） | 仍 code 10，**非原因**（保留此改动，见下） |
| B | `uploadWithSourceMap: true → false` | 仍 code 10，**非原因**（已还原为 true） |
| C | `ignoreDevUnusedFiles: true → false` | 三个分包页面**依然打不开**，**非原因**（已还原为 true）｜排查坑 #7 时做的对照，用来否掉"新文件被当成未使用文件忽略打包"的猜想 |

> 实验 C 的意义：`ignoreDevUnusedFiles` 只影响"未引用文件是否进包"，与**分包编译失败**无关。
> 当时三个页面打不开，真实原因是 wxml 里的复杂绑定表达式（坑 #7）。

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
| `mini-a/package-promo/pages/center/index.js` | 新增 `withdrawableYuan / earnedYuan / withdrawnYuan` 预计算 | 修坑 #7（wxml 里的 `.toFixed()`） |
| `mini-a/package-promo/pages/center/index.wxml` | 改用上面三个字段 | 同上 |
| `mini-a/package-content/pages/identity/index.js` | 新增 `levelName` / `statusText` 预计算 | 修坑 #7（数组字面量下标 + 嵌套三元） |
| `mini-a/package-content/pages/identity/index.wxml` | 改用 `{{d.profile.levelName}}` / `{{item.statusText}}` | 同上 |
| `api/test/diag-code.mjs` | **新增**：读 `__wxAppCode__` 判断分包是否真被编译 | 坑 #7/#8 的唯一可靠判据 |
| `api/test/diag-shots.mjs` | **新增**：导航后立即截图 + 抓 console | 区分"没打开 / 打开了但白屏 / 报错页" |

---

## 7. 验证记录

| 时间 | 动作 | 结果 |
|---|---|---|
| 21:0x 第 1 次 | `bash debug-cli.sh`（冷启动） | 逐页 7/7 OK + `FLOW DONE` + 脚本判定「调试通过」 |
| 21:0x 第 2 次 | 同上，紧接着再跑 | 同上（可重复性验证） |
| 21:1x | 改 `libVersion` 后重跑 | 逐页挂（exit=1）、链路过 —— 暴露坑 #6 连接预算不足 |
| 21:1x | 修连接重试后再连跑 **2 次** | 两次都是 7/7 OK + `FLOW DONE` + 「调试通过」 |
| 21:4x | 用同一条通道追加测 3 个分包页 | **3 个全部超时**；通道本身健康（回首页正常）→ 只有 7 页的"全绿"是覆盖率不足 |
| 21:5x | 二分定位（最小 wxml → 逐段加回） | 定位到 3 处 wxml 复杂表达式；改成 JS 预计算后逐页复活 |
| 21:5x | 扩到 **13 页**后整套复跑 | **13/13 OK + `FLOW DONE` + 「调试通过」**，截图目视确认两页内容渲染正常（`探索者` 等级、¥金额、凭证 7 条） |
| — | 截图 | `api/automator-shots-cli/`（逐页 14 张）、`api/automator-shots/`（链路 4 张）、`api/diag-shots/`（定位过程） |

---
## 8. 给下一个 AI 的检查清单

1. 先跑 `debug-cli.sh`。**别先读代码、别先改代码。**
2. 失败时按 §3 表格对症状，不要一上来就怀疑"小程序有 bug"——八个坑里六个都是环境/时序/编译静默问题。
3. 任何"页面全红但报 `[object Object]`"，先查 `MSYS_NO_PATHCONV`。
4. 任何"连上但超时"，先查是不是重复 `auto`。
5. **只测部分页面等于没测**：逐页清单必须覆盖 `app.json` 里全部 13 个页面。**覆盖率不足的"全绿"是有害的**——它会让真问题披着绿灯藏起来（本次三个分包页就是这样躲过两轮回归的）。
6. 单个分包的页面**全都不开**时，先跑 `node test/diag-code.mjs` 看 `__wxAppCode__` 有没有该分包键：
   - 没有 → 该分包**编译失败**（几乎都是 wxml 复杂表达式，见 §3.1），别在 JS/网络/appid 上浪费时间
   - 有 → 才是运行时问题，再查页面逻辑
7. 改 wxml 后若"仍打不开"，先怀疑**分包没重新编译**（坑 #8），用 `diag-code.mjs` 复核，再决定是否继续改代码。
8. 需要真机验证时，走 §5 的两条路，**别再在 `cli preview` 上反复试参数**——已排除的项不必重测。
9. 改完代码只需重跑 `debug-cli.sh`；若只改了测试脚本、小程序源码字节未变，跑单页冒烟即可。
