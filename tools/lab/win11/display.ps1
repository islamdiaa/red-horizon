# Set the Windows desktop resolution and/or display scaling of the lab VM.
#   tools/lab/lab.sh display win11 1920x1080 [150]
# Over SSH (session 0) this re-runs itself in the signed-in desktop session through a scheduled task.
# A scale change signs the user out; automatic sign-in brings the desktop back at the new DPI.
param([int]$Width = 1920, [int]$Height = 1080, [int]$Scale = 0, [switch]$InSession)
$ErrorActionPreference = 'Stop'
$log = 'C:\lab\display.log'

if (-not $InSession) {
  $id = 'rhlab-display'
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Width $Width -Height $Height -Scale $Scale -InSession"
  Remove-Item $log -ErrorAction SilentlyContinue
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $id -Action (New-ScheduledTaskAction -Execute powershell.exe -Argument $arg) -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $id
  for ($i = 0; $i -lt 30 -and -not (Test-Path $log); $i++) { Start-Sleep 1 }
  Start-Sleep 1
  Unregister-ScheduledTask -TaskName $id -Confirm:$false
  if (Test-Path $log) { Get-Content $log } else { 'display: no result (is the user signed in?)'; exit 1 }
  exit 0
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RhDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
  public static int Set(int w, int h) {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    EnumDisplaySettings(null, -1, ref dm);
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmFields = 0x80000 | 0x100000;
    return ChangeDisplaySettings(ref dm, 1); // CDS_UPDATEREGISTRY; 0 = DISP_CHANGE_SUCCESSFUL
  }
}
'@
$r = [RhDisplay]::Set($Width, $Height)
$out = "resolution ${Width}x${Height}: " + $(if ($r -eq 0) { 'ok' } else { "failed ($r)" })
if ($Scale -gt 0) {
  $dpi = [int][math]::Round(96 * $Scale / 100)
  Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels -Value $dpi -Type DWord
  Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name Win8DpiScaling -Value 1 -Type DWord
  $out += "; scale ${Scale}% (LogPixels $dpi): signing out to apply"
}
Set-Content $log $out
if ($Scale -gt 0) { Start-Sleep 2; shutdown.exe /l /f }
