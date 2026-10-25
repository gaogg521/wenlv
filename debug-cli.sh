#!/usr/bin/env bash
# 一键 CLI 调试 wanderlust/mini-a（微信开发者工具自动化通道 + 逐页检查 + 黄金链路）
# 用法：bash debug-cli.sh
# 前置：开发者工具「设置 → 安全设置 → 服务端口」已开启；本机已扫码登录
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_W="$(cd "$ROOT" && pwd -W)"      # 转成 C:/... 给 cli.bat（cmd 不认 /c/...）
MINI="$ROOT_W/mini-a"
API="$ROOT/api"
PORT="${AUTO_PORT:-9421}"

# ── 1. 定位 cli.bat：默认装 C 盘，本机实际装 D 盘 ─────────────────────
CLI=""
for c in \
  "/d/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" \
  "/d/Program Files/Tencent/微信web开发者工具/cli.bat" \
  "/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" \
  "/c/Program Files/Tencent/微信web开发者工具/cli.bat" \
  "$LOCALAPPDATA/Programs/Tencent/微信web开发者工具/cli.bat"; do
  if [ -f "$c" ]; then CLI="$c"; break; fi
done
if [ -z "$CLI" ]; then echo "✗ 未找到 cli.bat，请确认开发者工具安装位置"; exit 1; fi
echo "· cli: $CLI"

# ── 2. 服务端口 + 登录态 ──────────────────────────────────────────
echo "▶ 1/4 检查服务端口与登录态"
OUT="$("$CLI" islogin 2>&1)"
echo "$OUT" | grep -E 'login|IDE server' | tail -2
if ! echo "$OUT" | grep -q '"login":true'; then
  echo "✗ 未登录。先执行：\"$CLI\" login   （终端出二维码，微信扫码）"
  echo "  若报服务端口错误：开发者工具 → 设置 → 安全设置 → 打开「服务端口」"
  exit 1
fi

# ── 3. 干净地打开自动化通道 ────────────────────────────────────────
# 先 close 再 auto：同一个项目重复 auto 会留下半死会话（连上但命令超时）
echo "▶ 2/4 打开自动化通道 :$PORT（项目 mini-a）"
"$CLI" close --project "$MINI" >/dev/null 2>&1
sleep 2
"$CLI" auto --project "$MINI" --auto-port "$PORT" 2>&1 | grep -E 'auto|error' | tail -3

cd "$API" || exit 1
export AUTO_WS="ws://127.0.0.1:$PORT"

# ── 4. 逐页检查（脚本内部会等模拟器出首屏，不用 sleep 赌）─────────
echo "▶ 3/4 逐页检查（主包 5 页 + 分包 2 页）"
# MSYS_NO_PATHCONV=1 必须加：否则 /pages/xxx 会被 Git Bash 改写成 PortableGit 路径
MSYS_NO_PATHCONV=1 node test/automator-check.mjs "$MINI" ./automator-shots-cli \
  /pages/home/index /pages/tour-list/index /pages/shop/index /pages/bean/index /pages/me/index \
  /package-order/pages/orders/index /package-tour/pages/detail/index 2>&1 | grep -v Deprecation
chk=${PIPESTATUS[0]}

echo "▶ 4/4 黄金链路（详情→报名→MOCK支付→订单→核销码）"
MSYS_NO_PATHCONV=1 node test/automator-mini-a-flow.mjs 2>&1 | grep -v Deprecation
flow=${PIPESTATUS[0]}

echo ""
if [ "$chk" = 0 ] && [ "$flow" = 0 ]; then
  echo "✓ 调试通过。截图：api/automator-shots-cli/（逐页）、api/automator-shots/（链路）"
else
  echo "✗ 有失败（逐页 exit=$chk，链路 exit=$flow），看上面报错"
fi
echo "· 收工前释放通道（否则 preview 会撞车）：\"$CLI\" close --project \"$MINI\""
echo "· 真机调试：\"$CLI\" close --project \"$MINI\" && \"$CLI\" preview --project \"$MINI\""
