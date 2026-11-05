param([int]$Port)
$c = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -Unique OwningProcess
foreach ($p in $c) { try { Stop-Process -Id $p.OwningProcess -Force -ErrorAction Stop; Write-Output ("killed " + $p.OwningProcess) } catch {} }
if (-not $c) { Write-Output "no-listener" }
