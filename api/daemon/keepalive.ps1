# wanderlust API 看门狗：由 Windows 计划任务每分钟调用一次
# 端口不通则拉起 node 服务（脱离任何 IDE/会话进程树）
$ErrorActionPreference = 'SilentlyContinue'

$apiDir = 'C:\Users\allenzhao\Desktop\文旅项目\wanderlust\api'
$logFile = Join-Path $apiDir 'daemon\keepalive.log'
$port = 8080

function Write-Log($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  # 日志超过 2000 行则截断，避免无限增长
  $lines = @(Get-Content $logFile -ErrorAction SilentlyContinue)
  if ($lines.Count -gt 2000) {
    $lines | Select-Object -Last 500 | Set-Content -Path $logFile -Encoding UTF8
  }
}

# 1) 端口是否有监听
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) { exit 0 }   # 活着，静默退出

# 2) 端口空着，但可能有僵尸进程占着 --env-file 之外的启动方式，先不动，只补起一个
Start-Process -FilePath 'node' `
  -ArgumentList '--env-file=.env src/index.mjs' `
  -WorkingDirectory $apiDir `
  -WindowStyle Hidden

Start-Sleep -Seconds 5

# 3) 验证是否真的起来了
$ok = $false
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5
  if ($r.StatusCode -eq 200) { $ok = $true }
} catch { }

if ($ok) { Write-Log "端口 $port 无监听 → 已拉起，验证 200 OK" }
else { Write-Log "端口 $port 无监听 → 尝试拉起但验证失败，需人工介入" }
