# wanderlust API 看门狗：由 Windows 计划任务每分钟调用一次
# 端口不通则拉起 node 服务（脱离任何 IDE/会话进程树）
$ErrorActionPreference = 'Stop'

$apiDir = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $PSScriptRoot 'keepalive.log'
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
if ($listening) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/c/health" -TimeoutSec 5
    if ($health.code -eq 0 -and $health.data.app -eq 'wanderlust-api') { exit 0 }
  } catch { }
  Write-Log "端口 $port 已占用但 API 健康检查未通过，请检查现有进程；不自动终止占用者"
  exit 1
}

# 2) 端口空着，但可能有僵尸进程占着 --env-file 之外的启动方式，先不动，只补起一个
try {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $process = Start-Process -FilePath $nodePath `
  -ArgumentList '--env-file=.env src/index.mjs' `
  -WorkingDirectory $apiDir `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $PSScriptRoot 'api-stdout.log') `
  -RedirectStandardError (Join-Path $PSScriptRoot 'api-stderr.log')
} catch {
  Write-Log "启动 API 失败：$($_.Exception.Message)"
  exit 1
}

# 3) 冷启动可能包含数据库和配置加载，最多等待 45 秒。
$ok = $false
for ($attempt = 0; $attempt -lt 15; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/c/health" -TimeoutSec 1
    if ($health.code -eq 0 -and $health.data.app -eq 'wanderlust-api') { $ok = $true; break }
  } catch { }
  $process.Refresh()
  if ($process.HasExited) { break }
}

if ($ok) { Write-Log "端口 $port 无监听 → 已拉起，验证 200 OK" }
else {
  Write-Log "端口 $port 无监听 → 启动后健康检查失败，详见 daemon/api-stderr.log 与 api-stdout.log；下次计划任务重试"
  exit 1
}
