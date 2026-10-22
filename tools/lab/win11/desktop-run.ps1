# Run a Node script in the signed-in desktop session (session 1) instead of the SSH session
# (session 0, no desktop), so headed browsers get a real window. Used by `LAB_DESKTOP=1 lab.sh run win11 ...`.
param([string]$Dir, [string]$Script, [string]$Out, [string]$GameUrl, [string]$ArgLine = '')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$id = 'rhlab-desktop-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$log = Join-Path $Out 'console.log'
$code = Join-Path $Out 'exitcode.txt'
$runner = Join-Path $Out 'run.ps1'
Set-Content $runner -Encoding UTF8 @"
Set-Location '$Dir'
`$env:GAME_URL = '$GameUrl'; `$env:OUT_DIR = '$Out'; `$env:HEADED = '1'
& node $Script $ArgLine *> '$log'
Set-Content '$code' `$LASTEXITCODE
"@
Remove-Item $code -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $id -Action $action -Principal $principal -Settings $settings -Force | Out-Null
try {
  Start-ScheduledTask -TaskName $id
  Start-Sleep 2
  while ((Get-ScheduledTask -TaskName $id).State -in 'Running', 'Queued') { Start-Sleep 2 }
} finally {
  Unregister-ScheduledTask -TaskName $id -Confirm:$false
}
if (Test-Path $log) { Get-Content $log }
if (-not (Test-Path $code)) { Write-Host 'desktop-run: the task did not finish (is the user signed in?)'; exit 1 }
exit [int](Get-Content $code)
