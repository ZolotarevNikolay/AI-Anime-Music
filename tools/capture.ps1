param(
  [string]$Out = "C:\Users\Николай\AppData\Local\Temp\opencode\win.png"
)

Add-Type @'
using System;using System.Drawing;using System.Runtime.InteropServices;
public class Cap {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
}
'@ -ReferencedAssemblies System.Drawing

$p = Get-Process electron -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowTitle -ne '' } |
     Select-Object -First 1

if (-not $p) { Write-Output "window not found"; exit 1 }

$h = $p.MainWindowHandle
$r = New-Object Cap+RECT
[Cap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L
$ht = $r.B - $r.T

$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[Cap]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$bmp.Save($Out)
Write-Output "saved $Out ($w x $ht)"
