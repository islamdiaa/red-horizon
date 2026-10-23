# Stops a net-lab peer server on the Windows test VM and everything it started (vm-party.sh / vm-match.sh cleanup).
# A killed node server leaves its browser's helper processes running (crash handler, on-device model service), so the
# whole process tree is taken first, the server is asked to close its browser (PEER_STOP_FILE), and whatever is still
# alive after that is stopped. Then the run's firewall rules and files go.
param([int]$Port)
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $all = New-Object System.Collections.ArrayList
  function Add-Tree([int]$id) { [void]$all.Add($id); Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" | ForEach-Object { Add-Tree $_.ProcessId } }
  Add-Tree $conn.OwningProcess
  New-Item -ItemType File -Force "C:/lab/pw/peer-$Port.stop" | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  Start-Sleep 2
  $left = 0
  foreach ($id in $all) { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { $left++; Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }
  "peer $Port`: tree of $($all.Count) processes, $left still running after the graceful stop"
}
Remove-NetFirewallRule -DisplayName "rh-lab-net-peer-$Port", 'rh-lab-net-cut-out', 'rh-lab-net-cut-in' -ErrorAction SilentlyContinue
foreach ($f in "C:/lab/pw/peer-server-$Port.mjs", "C:/lab/pw/peer-$Port.log", "C:/lab/pw/peer-$Port.err", "C:/lab/pw/peer-$Port.stop") { Remove-Item $f -Force -ErrorAction SilentlyContinue }
