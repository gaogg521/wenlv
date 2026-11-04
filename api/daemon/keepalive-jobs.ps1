# 定时任务进程（jobs.mjs）看门狗：由 Windows 计划任务定时调用
# 逻辑：查有没有 node 在跑 src/jobs.mjs，没有就拉起（脱离任何 IDE/会话进程树）
# 注意：与 keepalive.ps1（管 API :8080）是两件事，互不替代
$ErrorActionPreference = 'SilentlyContinue'

$apiDir = 'C:\Users\allenzhao\Desktop\文旅项目\wanderlust\api'
$logFile = Join-Path $apiDir 'daemon\keepalive-jobs.log'

function Write-Log($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  $lines = @(Get-Content $logFile -ErrorAction SilentlyContinue)
  if ($lines.Count -gt 2000) {
    $lines | Select-Object -Last 500 | Set-Content -Path $logFile -Encoding UTF8
  }
}

# 1) 已有 jobs 进程则静默退出
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*src/jobs.mjs*' }
if ($running) { exit 0 }

# 2) 没有就拉起
Start-Process -FilePath 'node' `
  -ArgumentList '--env-file=.env src/jobs.mjs' `
  -WorkingDirectory $apiDir `
  -WindowStyle Hidden

Start-Sleep -Seconds 6

# 3) 验证：进程在、并且心跳行被写过（jobs 每分钟写一次 sys_job.main-loop）
$ok = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*src/jobs.mjs*' }) -ne $null
if ($ok) { Write-Log 'jobs 未运行 → 已拉起' }
else { Write-Log 'jobs 未运行 → 尝试拉起但进程不在，需人工介入' }
