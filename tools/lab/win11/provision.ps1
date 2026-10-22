# Provision rh-test-win11 (run over SSH by `lab.sh provision win11`; idempotent).
# Installs Google Chrome (stable, enterprise MSI), Firefox (stable), Node LTS and Playwright
# (its Chromium, Firefox and WebKit builds; the chrome and msedge channels use the installed browsers).
param([string]$PwVersion = '1.64.1')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Step($m) { Write-Host "== $(Get-Date -Format s) $m" }
New-Item -ItemType Directory -Force C:\lab\dl, C:\lab\pw\jobs, C:\lab\pw\out | Out-Null
function Fetch($url, $out) { if (-not (Test-Path $out)) { Invoke-WebRequest -UseBasicParsing $url -OutFile $out } }
function Msi($file, $extra = '') {
  $p = Start-Process msiexec.exe -Wait -PassThru -ArgumentList "/i `"$file`" /qn /norestart $extra"
  if ($p.ExitCode -notin 0, 1641, 3010) { throw "msiexec $file failed: $($p.ExitCode)" }
}

Step 'Google Chrome'
if (-not (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe')) {
  Fetch 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi' C:\lab\dl\chrome.msi
  Msi C:\lab\dl\chrome.msi
}

Step 'Firefox'
if (-not (Test-Path 'C:\Program Files\Mozilla Firefox\firefox.exe')) {
  Fetch 'https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US' C:\lab\dl\firefox.exe
  $sig = Get-AuthenticodeSignature C:\lab\dl\firefox.exe
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Mozilla') { throw "Firefox installer signature: $($sig.Status)" }
  Start-Process C:\lab\dl\firefox.exe -Wait -ArgumentList '/S'
}

Step 'Visual C++ runtime (Playwright WebKit needs msvcp140_1.dll)'
if (-not (Test-Path C:\Windows\System32\msvcp140_1.dll)) {
  Fetch 'https://aka.ms/vs/17/release/vc_redist.x64.exe' C:\lab\dl\vc_redist.x64.exe
  $sig = Get-AuthenticodeSignature C:\lab\dl\vc_redist.x64.exe
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Microsoft') { throw "vc_redist signature: $($sig.Status)" }
  Start-Process C:\lab\dl\vc_redist.x64.exe -Wait -ArgumentList '/install /quiet /norestart'
}

Step 'Browser policies: no first-run screens or default-browser nags'
foreach ($k in 'HKLM:\SOFTWARE\Policies\Google\Chrome', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge') {
  New-Item -Path $k -Force | Out-Null
  New-ItemProperty -Path $k -Name DefaultBrowserSettingEnabled -Value 0 -PropertyType DWord -Force | Out-Null
}
New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' -Name HideFirstRunExperience -Value 1 -PropertyType DWord -Force | Out-Null

Step 'Node LTS'
$idx = Invoke-RestMethod -UseBasicParsing https://nodejs.org/dist/index.json
$ver = ($idx | Where-Object { $_.lts })[0].version
$have = try { (& 'C:\Program Files\nodejs\node.exe' -v) } catch { '' }
if ($have -ne $ver) {
  $msi = "C:\lab\dl\node-$ver-x64.msi"
  Fetch "https://nodejs.org/dist/$ver/node-$ver-x64.msi" $msi
  $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$ver/SHASUMS256.txt").Content
  $want = ($sums -split "`n" | Where-Object { $_ -match "  node-$ver-x64\.msi$" }) -replace '\s.*$', ''
  $got = (Get-FileHash $msi -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $want) { throw "node msi hash mismatch: $got vs $want" }
  Msi $msi
}
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

Step "Playwright $PwVersion"
Set-Location C:\lab\pw
if (-not (Test-Path package.json)) { Set-Content package.json '{"name":"rh-lab-pw","private":true,"type":"module"}' -Encoding ASCII }
& npm.cmd install --no-audit --no-fund --loglevel=error "playwright@$PwVersion"
if ($LASTEXITCODE) { throw 'npm install failed' }
& npx.cmd playwright install chromium firefox webkit
if ($LASTEXITCODE) { throw 'playwright install failed' }

Step 'Versions'
$chrome = (Get-Item 'C:\Program Files\Google\Chrome\Application\chrome.exe').VersionInfo.ProductVersion
$edge = (Get-Item 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe').VersionInfo.ProductVersion
$ff = (Get-Item 'C:\Program Files\Mozilla Firefox\firefox.exe').VersionInfo.ProductVersion
$os = Get-CimInstance Win32_OperatingSystem
"chrome=$chrome"; "msedge=$edge"; "firefox=$ff"; "node=$(node -v)"; "playwright=$(& npx.cmd playwright --version)"
"os=$($os.Caption) $($os.Version) build $($os.BuildNumber)"
Get-CimInstance Win32_VideoController | ForEach-Object { "video=$($_.Name) driver=$($_.DriverVersion)" }
