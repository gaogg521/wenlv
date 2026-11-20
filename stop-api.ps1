# Stops the running wanderlust API (node ... src/index.mjs), however it was started
# (start-all.cmd, start-api.cmd, start-8080.cmd, keepalive.ps1).
# Why by command line and not by port: on this machine netstat / Get-NetTCPConnection
# report PID 0 for the :8080 listener, so the owner cannot be resolved from the port.
# The QA instance (start-qa.cmd, plain "node src/index.mjs" on :18095) is left alone.
$all = Get-CimInstance Win32_Process
$api = @($all | Where-Object {
  $_.Name -eq 'node.exe' -and
  $_.CommandLine -match 'src[\\/]index\.mjs' -and
  $_.CommandLine -notmatch '^node\s+src'
})

foreach ($p in $api) {
  Write-Output ("Stopping API node PID {0}: {1}" -f $p.ProcessId, $p.CommandLine)
  # also close the "cmd /k" window that hosts it, so no dead console is left behind
  $host_ = $all | Where-Object {
    $_.ProcessId -eq $p.ParentProcessId -and $_.Name -eq 'cmd.exe' -and $_.CommandLine -match '/k'
  }
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  if ($host_) { Stop-Process -Id $host_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($api.Count -eq 0) { Write-Output 'No running API process found.' }
