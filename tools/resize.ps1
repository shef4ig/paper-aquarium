# Resize an image to a max dimension, save as PNG. System.Drawing only.
# Usage: powershell -File tools/resize.ps1 -In <src> -Out <dst.png> -Max 1600
param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Max = 1600
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $In))
$k = [math]::Min(1.0, $Max / [math]::Max($src.Width, $src.Height))
$W = [int]($src.Width * $k); $H = [int]($src.Height * $k)
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $W, $H)
$g.Dispose(); $src.Dispose()
$dir = Split-Path $Out -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("resized {0} -> {1} ({2}x{3})" -f $In, $Out, $W, $H)
