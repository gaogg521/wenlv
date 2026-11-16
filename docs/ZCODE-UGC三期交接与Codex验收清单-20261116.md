# UGC 三期+收尾 全局交接与 Codex 验收清单

2026-11-16 · 基线 main=**ef08d9a**（提交链 f5e3598 三期 → 640370e 流水线复验 → ef08d9a 收尾清零）· 演示 8080 已部署本版并冒烟通过。

本交接覆盖「UGC 小红书化三期 + 收尾轮」全部交付。验收依据：本文 + 台账 `docs/ZCODE-UGC小红书化验收-20261115.md`（第三/四/五轮）+ UX 登记 `docs/R1-R4复验与三端UX逐页登记-20261113.md` §七。

---

## 一、工程状态

| 项 | 状态 |
|---|---|
| 主线 | main=ef08d9a，远端已推送（github.com/gaogg521/wenlv） |
| 迁移 | V88（content_note + visibility/scenic_id + 两个索引）、V89（content_note_draft）——**隔离库全新迁移 87 个一次通过**；演示库此前已被 Codex 应用过同名 V88/V89（内容一致，skip 无害） |
| 演示环境 | 8080 `--env-file=.env` 运行 ef08d9a；冒烟：/c/note-scenics ✓、/c/note-video/trim 参数校验 ✓、feed 下发 topics ✓ |
| 隔离环境 | wanderlust_qa_xhs3 / PORT=18240（回归后残留，可随时 DROP；起服口径见 §六） |
| 素材目录 | `文旅项目/demo-media/`（真实网络素材，不入库）；测试夹具 `api/test/fixtures/`（已入库） |

## 二、交付范围（验收范围）

### 三期七项（f5e3598）
1. **话题聚合**：feed `?topic=`/`?scenic=`（topics 入库统一小写）；广场搜索框+过滤头+卡片话题 chips；详情话题/景区可点跳转
2. **AI 排版建议落地**：guide 字段→面板展示「路线攻略/图文打卡」+应用时自动补对应话题
3. **评论骨架屏**：首次加载三段灰阶 + 展开回复楼内骨架行
4. **云草稿（V89）**：GET/POST/DELETE `/c/note-drafts`（乐观锁/30 篇/230KB）+ compose onHide 云同步 + 创作中心恢复/删除 + 发布事务内原子清稿；`GET /c/note-scenics` 景区选择器
5. **语音评论**：🎙 录制（RecorderManager mp3 ≤30s）→试听→发送→▶ 播放胶囊；wxapi `mediaType=1`（音频机审类型）
6. **私密媒体（V88）**：visibility 全链门禁（feed/详情/点赞/举报/任务投稿）+ **index.mjs 静态服务门禁** + compose 可见范围选择 + admin 三处 note-review 票据注入
7. **拖拽排序**：compose 缩略图条长按拖动，封面按 key 跟随；cover URL 下发（服务端兼容旧 coverIndex）

### 演示流水线复验（640370e）
真实网络素材（Wikimedia 朱家角/乌镇图×5 + 上海延时 webm→25s/4MB mp4）×3 条 UGC 全流水线 11/11：UI 发布→机审降级转人工→后台 verdict→广场/话题→评论点赞→视频 Range 206→语音评论预期错误路径。**修真 bug：publish 成功后 onHide 把已发布内容写回草稿**（_published 标志跳过）。

### 收尾轮（ef08d9a）
8. **视频剪辑**：`editNoteVideo`（ffmpeg 裁剪/滤镜 warm·mono·vivid/角标贴纸/全程+分段字幕 ≤12 ASS 渲染/内置 BGM `api/video/audio/bgm.wav` 或自定义 mp3/自定义贴纸 png；输出限本人命名 ugc-video-\<uid\>-*、并发限 2）+ `POST /c/note-video/trim|cover|asset`；compose 剪辑面板（slider×3/滤镜 4 选/角标 4 选/字幕/BGM/自定义资产/生成/封面帧）
9. **实况照片**：compose 图片位绑定 ≤3s motion（删图同步清绑定）+ 详情「▶ 实况」浮层播放；详情下发 livePhotos、edit 下发 cover
10. **place 反向入口**：景区详情「看这个景区的旅行笔记 ›」→ `square?scenic=&scenicName=`
11. **demo.html 口径对齐**：合伙人 95→推广服务商（城市合伙人 7 保留）、四端→三端、禁词 31 类文本层 0 残留、div 2323/2323 配平；JS 键名（DB.web3/did:/token）与 CSS 类名保留
12. **UX 游客端模拟器矩阵**：26/26 页全通（`automator-shots-ux-pages/` 27 截图）；automator-check 兼容 devtools 3.17.5 reLaunch 绝对路径
13. **wt-codex-b34 处置**：未提交 diff 快照 `backup/codex-b34-uncommitted.diff`（2610 行）+ README；核心功能全吸收，剩余未搬（正文混排编辑器/复制粘贴/在线导入）由 compose 两段式覆盖等价体验；工作树可删

## 三、测试与回归基线（全部通过）

| 套件 | 结果 | 位置 |
|---|---|---|
| 隔离库全量回归 | **301 断言全绿 EXIT=0**（wanderlust_qa_xhs3/18240 全新迁移 87 个） | `npm run test:db` |
| 三期专项 | content-xhs3 **11/11**（门禁四态/跨可见范围冲突/云草稿乐观锁+发布原子清稿/语音评论/话题校验/批量通过收紧） | `api/test/content-xhs3.mjs`（已入 test:db 链） |
| 旧测试适配 | content-review 14/14、audit-p1 13/13、audit-a41-44 9/9、remaining-readiness 通过（伪造图→真上传适配新所有权契约） | api/test/ |
| 游客端走查 | 三期 12/12（`automator-xhs3-walk.mjs`，截图 automator-shots-xhs3/30-42）+ 流水线 11/11（`ugc-pipeline-demo-walk.mjs`，automator-shots-ugc-pipeline/）+ 剪辑面板 3/3（`ve-panel-walk.mjs`，u1-u3）+ 26 页矩阵 | automator-shots-*（均不入库） |
| WXML 铁律 | compose/note/square/create 配平 ✓、无嵌套三元 ✓ | 逐轮检查 |

## 四、关键契约（验收判定的口径依据）

1. **机审降级**：mediaCheckAsync throw → 整篇 status=1 + `body.imgSec[].degraded`，绝不 500/直发（remaining-readiness 断言按此）。演示机无公网 HTTPS → 图/语音真实通道必降级（预期行为）；文本机审可真通。
2. **媒体门禁语义**：note 素材（note_\<uid\>_*/ugc-video-*）仅本人/被公开笔记引用/持 note-review 票据可读；**note-editor 票据不放大「仅私密引用」素材的读取权**（canReadNoteMedia 先查 private_asset=1→false）——私密编辑/详情走 downloadPrivateMedia 登录态下载；篡改票据 404。admin 三处素材下发已注 note-review 票据。
3. **素材所有权**：笔记图片必须本人上传（note-media.mjs 校验）——新增测试一律真上传，伪造 `/uploads/x.png` 会被 1001 拒。
4. **月度发豆 cap**：`content.publish_reward_monthly_cap=10` 封顶时 grantPublishReward 静默跳过、reward_granted 留 0 待重试——**设计行为非 bug**（老账号当月配额用满时第 11 篇发 0 豆）。
5. **话题**：入库统一小写、服务端剥离前导 #（V86 兼容）、≤5 个/单个≤20 字、非法字符拒。
6. **批量通过**：限 revision=1 且无视频稿（修订/视频稿必须逐篇 verdict）。
7. **视频剪辑**：输出限本人 ugc-video-<uid>-* 命名；ugc-edit-*（贴纸/音乐资产）由 index.mjs 404 挡外链；ffprobe 校验实况 ≤3.1s。

## 五、Codex 验收清单（建议按序执行）

**A. 自动化断言（隔离库，快）**
1. 按 §六 口径起隔离库 18240 → `npm run test:db` → 预期 301 断言 EXIT=0，`内容三期：11 项通过`。
2. 单独复跑 `node test/content-xhs3.mjs`（带 API_BASE=http://127.0.0.1:18240）→ 11/11。

**B. 演示 8080 API 抽验（无需小程序）**
3. `GET /c/notes/feed?topic=古镇漫步` → 仅命中带该话题的公开笔记，items[].topics 数组下发。
4. 用户 A 发私密笔记（visibility=private）→ feed 排除；用户 B `GET /c/notes/:id` → 1004；B 读其素材 URL → 404 no-store；A 本人读 → 200。
5. `POST /c/note-video/asset`（png/mp3 base64）→ ugc-edit-<uid>-* 资产名；`GET /uploads/<asset>` → 404。
6. `POST /c/note-drafts` 过期 revision → 2002。

**C. 小程序模拟器走查（devtools auto-port 9421；工具链口径见 §七）**
7. compose：选图 → 缩略图条长按拖拽（顺序变/封面跟随）→ 可见范围「仅自己」→ 发布 → 创作中心云草稿行出现 → 恢复回填。
8. compose 视频稿 →「✂️ 剪辑」→ 配置滤镜/角标/BGM/字幕 →「生成剪辑」→ ffmpeg 出片替换视频位 →「封面帧」设封面 → 发布。
9. compose 图片「▶ 实况」绑定 3s 片段 → 发布 → 详情图集「▶ 实况」浮层播放。
10. 详情话题 chip → 话题聚合页；place（景区）→「看这个景区的旅行笔记」→ scenic 聚合页头。
11. 语音评论：录制（真机）或夹具发送 → 列表语音行 → 播放胶囊。

**D. 文档与口径**
12. `docs/PPT素材-20261108/demo.html` 浏览器打开人工过一遍：无禁词残留、句子通顺（程序化替换后语义通顺度是唯一无法自动断言的点）。
13. `backup/codex-b34-uncommitted.diff` 抽查确认吸收完整性（可对照其 create 页 diff）。

## 六、环境复现口径（Codex 复验必读）

- **隔离库**：`CREATE DATABASE wanderlust_qa_<新>` → `DB_NAME=<库> node scripts/migrate.mjs`（不带 env）→ 起服最小 env：`DB_NAME=<库> PORT=1824x DB_HOST/DB_USER/DB_PASS=root JWT_SECRET=wanderlust-dev-jwt-secret-change-me PASS_SECRET=change-me-pass-code-secret node src/index.mjs`（三不带：ADMIN_INIT_PASSWORD/WX 凭据/演示 env）→ `DB_NAME=<库> API_BASE=http://127.0.0.1:1824x PORT=1824x <同套> node test/scenario-populate.mjs` → `npm run test:db`（PORT 必须钉隔离端口）。
- **devtools 自动化**：`cli.bat close --project <mini-a 绝对路径>` → `cli.bat auto --project <mini-a> --auto-port 9421`；改 mini-a 代码后必须 close+auto 重编译。
- **automator 铁律**：夹具指 USER_DATA_PATH 真实文件（分块 base64 写入）；**沙箱配额约 10MB，跑批前全清 USER_DATA_PATH**；防残留 token 须 storage+globalData 双清（`getApp().globalData.token=''`）；注销 mock 用 `restoreWxMethod`（`mockWxMethod(x,null)` 是注册 null 结果会挂死）；reLaunch **必须带前导 /**（devtools 3.17.5）；原生 showModal 卡截图（直调确认语义函数）；page handle 在 reLaunch 后重新 currentPage()。
- **python 补丁**：git autocrlf 会把工作区转 CRLF——补丁脚本先 normalize `\r\n→\n` 再 replace 并**断言命中**（静默零匹配=白干）。

## 七、已知边界与外部条件（不在本轮验收范围）

| 项 | 说明 |
|---|---|
| 真机验证 | 真机 LAN 预览、真机录音语音评论、真机实况拍摄未验（需真人扫码） |
| B 端 | WX_B_APPID/SECRET 未配置，真机 code2Session/门店权限/跨端 unionid 未验 |
| 占位域名 | `api.wenlv.example` 提审前必须替换（两端 app.js 的 API_BASE_RELEASE） |
| 公网 HTTPS | 媒体真机审（图/语音直发）需公网 HTTPS 部署；本机部署永远降级转人工 |
| 凭据 | M-01 真实短信、C-06/07 真实收件（代码+假服务就绪） |
| 演示 .env | JWT_SECRET 与 dev 同值，建议换独立值（旧 token 跨端口有效） |
| Web3 链凭据 | chain-ready NOOP 期，仅差正式链凭据 |
| 遗留小缺口 | 编辑已发布**视频稿**时自定义封面不回显（coverUrl 进 data 但 UI 无展示位，重设即可）；剪辑面板 slider 依赖 bindloadedmetadata（极慢网下初始不可拖）；demo.html 替换后语义通顺度待人工过一遍 |

## 八、回滚

main 回滚点：`54fc718`（三期前）→ `f5e3598` → `640370e` → `ef08d9a`。演示库 V88/V89 与 Codex 版同名同内容（无冲突）；回滚 V88 后 content_note 多列需手工 DROP（有 feed/详情查询依赖，建议整库回退而非单迁移）。
