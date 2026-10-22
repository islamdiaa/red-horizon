# Red Horizon lab: first-logon setup for rh-test-win11 (run from the answer ISO by autounattend.xml).
# Installs the VirtIO guest tools, turns off sleep/lock/auto-updates and enables OpenSSH Server with
# key auth (the lab public key sits next to this script). Browsers etc. come later from provision.ps1.
param([string]$Src = $PSScriptRoot)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Start-Transcript -Path C:\rhlab-setup.log -Append | Out-Null

function Step($m) { Write-Host "== $(Get-Date -Format s) $m" }

Step 'VirtIO guest tools and agent'
$cd = Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root 'virtio-win-gt-x64.msi') } | Select-Object -First 1
if ($cd) {
  Start-Process msiexec.exe -Wait -ArgumentList "/i `"$($cd.Root)virtio-win-gt-x64.msi`" /qn /norestart ADDLOCAL=ALL"
  Start-Process msiexec.exe -Wait -ArgumentList "/i `"$($cd.Root)guest-agent\qemu-ga-x86_64.msi`" /qn /norestart"
}

Step 'Power, lock screen, screen saver'
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
function SetReg($path, $name, $value, $type = 'DWord') {
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  New-ItemProperty -Path $path -Name $name -Value $value -PropertyType $type -Force | Out-Null
}
SetReg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' NoLockScreen 1
SetReg 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' InactivityTimeoutSecs 0
SetReg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Control Panel\Desktop' ScreenSaveActive '0' String
SetReg 'HKCU:\Control Panel\Desktop' ScreenSaveActive '0' String

Step 'Windows Update: no automatic install or reboot'
$wu = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
SetReg "$wu\AU" NoAutoUpdate 1
SetReg "$wu\AU" NoAutoRebootWithLoggedOnUsers 1
SetReg $wu DeferFeatureUpdates 1
SetReg $wu DeferFeatureUpdatesPeriodInDays 365
SetReg $wu DeferQualityUpdates 1
SetReg $wu DeferQualityUpdatesPeriodInDays 30
SetReg $wu SetAutoRestartNotificationDisable 1
$until = (Get-Date).ToUniversalTime().AddDays(35).ToString('yyyy-MM-ddTHH:mm:ssZ')
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$ux = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
foreach ($k in 'PauseUpdatesExpiryTime', 'PauseFeatureUpdatesEndTime', 'PauseQualityUpdatesEndTime') { SetReg $ux $k $until String }
foreach ($k in 'PauseUpdatesStartTime', 'PauseFeatureUpdatesStartTime', 'PauseQualityUpdatesStartTime') { SetReg $ux $k $now String }

Step 'Keep signing in automatically (the desktop session runs headed browser tests)'
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
SetReg $wl AutoAdminLogon '1' String
SetReg $wl ForceAutoLogon '1' String  # also sign back in after a sign-out (e.g. a display scale change)
Remove-ItemProperty -Path $wl -Name AutoLogonCount -ErrorAction SilentlyContinue

Step 'Defender: skip the lab folder (browser downloads are huge)'
New-Item -ItemType Directory -Force C:\lab | Out-Null
Add-MpPreference -ExclusionPath C:\lab -ErrorAction SilentlyContinue

Step 'Network: private profile, wait for connectivity'
Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue
for ($i = 0; $i -lt 60; $i++) {
  try { if ((Resolve-DnsName -Name download.microsoft.com -ErrorAction Stop)) { break } } catch { Start-Sleep 5 }
}

Step 'OpenSSH Server'
$cap = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*' | Select-Object -First 1
if ($cap -and $cap.State -ne 'Installed') {
  try { Add-WindowsCapability -Online -Name $cap.Name -ErrorAction Stop | Out-Null } catch { Write-Host "Add-WindowsCapability failed: $_" }
}
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
  Step 'OpenSSH Server: falling back to the Win32-OpenSSH MSI from GitHub'
  $rel = Invoke-RestMethod -UseBasicParsing https://api.github.com/repos/PowerShell/Win32-OpenSSH/releases/latest
  $asset = $rel.assets | Where-Object name -match 'Win64.*\.msi$' | Select-Object -First 1
  Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile C:\lab\openssh.msi
  Start-Process msiexec.exe -Wait -ArgumentList '/i C:\lab\openssh.msi /qn /norestart ADDLOCAL=Server'
}
Set-Service sshd -StartupType Automatic
Start-Service sshd
SetReg 'HKLM:\SOFTWARE\OpenSSH' DefaultShell 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' String
# Key-only SSH. And no account lockout: every Chrome/Edge launch from an SSH (S4U) session logs a
# failed interactive logon (the browser probes for a blank OS password), so ~10 launches would
# lock the lab account for 10 minutes and SSH would fail with "Connection reset".
$cfg = 'C:\ProgramData\ssh\sshd_config'
if (-not (Select-String -Path $cfg -Pattern '^PasswordAuthentication no' -Quiet)) {
  Set-Content $cfg -Value (@('PasswordAuthentication no') + (Get-Content $cfg)) -Encoding ascii
}
net accounts /lockoutthreshold:0 | Out-Null
$ak = 'C:\ProgramData\ssh\administrators_authorized_keys'
Copy-Item (Join-Path $Src 'rhlab-authorized_keys') $ak -Force
icacls.exe $ak /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null
Get-NetFirewallRule -Name 'rhlab-ssh' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name 'rhlab-ssh' -DisplayName 'OpenSSH Server (lab)' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -Name 'rhlab-icmp' -DisplayName 'ICMPv4 echo (lab)' -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
Restart-Service sshd

Step 'done'
Set-Content -Path C:\rhlab-setup.done -Value (Get-Date -Format s)
Stop-Transcript | Out-Null
