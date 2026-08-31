# Auto slicer: cuts objects off a magazine page (colored/white background).
# Background is detected as the perimeter median color; connected object
# components are cut into separate PNGs with transparent background.
# No external deps - only System.Drawing (.NET on Windows).
#
# Usage:
#   powershell -File tools/slice-page.ps1 -In <page.png> -OutDir <dir> -Prefix <name>
#   [-MinArea 12000] [-Scale 0.4] [-Pad 12] [-BgTolerance 60]
#
# Prints JSON describing found objects (file, bbox, aspect) to stdout.

param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [string]$Prefix = "item",
  [int]$MinArea = 12000,
  [double]$Scale = 0.4,
  [int]$Pad = 12,
  [int]$BgTolerance = 60
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$src = [System.Drawing.Image]::FromFile((Resolve-Path $In))
$W = [int]($src.Width * $Scale); $H = [int]($src.Height * $Scale)

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $W, $H)
$g.Dispose()
$src.Dispose()

$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)

# Background color = perimeter median (robust to a shape touching the edge).
$perR = New-Object System.Collections.ArrayList
$perG = New-Object System.Collections.ArrayList
$perB = New-Object System.Collections.ArrayList
function SamplePerim([int]$x, [int]$y) {
  $pi = $y * $stride + $x * 4
  [void]$perB.Add([int]$bytes[$pi]); [void]$perG.Add([int]$bytes[$pi+1]); [void]$perR.Add([int]$bytes[$pi+2])
}
for ($x = 0; $x -lt $W; $x += 3) { SamplePerim $x 0; SamplePerim $x ($H-1) }
for ($y = 0; $y -lt $H; $y += 3) { SamplePerim 0 $y; SamplePerim ($W-1) $y }
function Median($list) { $s = $list | Sort-Object; return $s[[int]($s.Count/2)] }
$bgR = Median $perR; $bgG = Median $perG; $bgB = Median $perB
Write-Host ("bg color: {0},{1},{2}" -f $bgR, $bgG, $bgB)

function IsBgColor([int]$i) {
  $b = $bytes[$i]; $gr = $bytes[$i+1]; $r = $bytes[$i+2]
  $d = [math]::Abs($r - $bgR) + [math]::Abs($gr - $bgG) + [math]::Abs($b - $bgB)
  return $d -le $BgTolerance
}

$N = $W * $H
$bg = New-Object byte[] $N
$stackX = New-Object int[] $N
$stackY = New-Object int[] $N
$sp = 0

function PushBg([int]$x, [int]$y, [bool]$force) {
  $idx = $y * $W + $x
  if ($bg[$idx]) { return }
  $pi = $y * $stride + $x * 4
  if ($force -or (IsBgColor $pi)) {
    $bg[$idx] = 1
    $script:stackX[$script:sp] = $x
    $script:stackY[$script:sp] = $y
    $script:sp++
  }
}

# Seed: whole perimeter as background.
for ($x = 0; $x -lt $W; $x++) { PushBg $x 0 $true; PushBg $x ($H-1) $true }
for ($y = 0; $y -lt $H; $y++) { PushBg 0 $y $true; PushBg ($W-1) $y $true }

while ($sp -gt 0) {
  $sp--
  $px = $stackX[$sp]; $py = $stackY[$sp]
  for ($dy = -1; $dy -le 1; $dy++) {
    for ($dx = -1; $dx -le 1; $dx++) {
      $nx = $px + $dx; $ny = $py + $dy
      if ($nx -ge 0 -and $ny -ge 0 -and $nx -lt $W -and $ny -lt $H) { PushBg $nx $ny $false }
    }
  }
}

# Connected components of the non-background pixels.
$label = New-Object int[] $N
$objects = @()
$curLabel = 0

for ($start = 0; $start -lt $N; $start++) {
  if ($bg[$start] -or $label[$start]) { continue }
  $curLabel++
  $minX = $W; $maxX = 0; $minY = $H; $maxY = 0; $area = 0
  $sp = 0
  $stackX[0] = $start % $W; $stackY[0] = [int]($start / $W); $sp = 1
  $label[$start] = $curLabel
  while ($sp -gt 0) {
    $sp--
    $px = $stackX[$sp]; $py = $stackY[$sp]
    $area++
    if ($px -lt $minX) { $minX = $px }; if ($px -gt $maxX) { $maxX = $px }
    if ($py -lt $minY) { $minY = $py }; if ($py -gt $maxY) { $maxY = $py }
    for ($dy = -1; $dy -le 1; $dy++) {
      for ($dx = -1; $dx -le 1; $dx++) {
        $nx = $px + $dx; $ny = $py + $dy
        if ($nx -ge 0 -and $ny -ge 0 -and $nx -lt $W -and $ny -lt $H) {
          $q = $ny * $W + $nx
          if (-not $bg[$q] -and -not $label[$q]) {
            $label[$q] = $curLabel
            $stackX[$sp] = $nx; $stackY[$sp] = $ny; $sp++
          }
        }
      }
    }
  }
  if ($area -ge $MinArea) {
    $objects += [pscustomobject]@{ label = $curLabel; minX = $minX; maxX = $maxX; minY = $minY; maxY = $maxY; area = $area }
  }
}

# Reading order: top-to-bottom in bands, then left-to-right.
$objects = $objects | Sort-Object { [math]::Floor($_.minY / 40) }, minX

$result = @()
$n = 0
foreach ($o in $objects) {
  $x0 = [math]::Max(0, $o.minX - $Pad); $y0 = [math]::Max(0, $o.minY - $Pad)
  $x1 = [math]::Min($W-1, $o.maxX + $Pad); $y1 = [math]::Min($H-1, $o.maxY + $Pad)
  $ow = $x1 - $x0 + 1; $oh = $y1 - $y0 + 1

  $out = New-Object System.Drawing.Bitmap $ow, $oh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $od = $out.LockBits((New-Object System.Drawing.Rectangle 0,0,$ow,$oh), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $ostride = $od.Stride
  $obytes = New-Object byte[] ($ostride * $oh)
  for ($yy = 0; $yy -lt $oh; $yy++) {
    for ($xx = 0; $xx -lt $ow; $xx++) {
      $sx = $x0 + $xx; $sy = $y0 + $yy
      $si = $sy * $stride + $sx * 4
      $di = $yy * $ostride + $xx * 4
      $lab = $label[$sy * $W + $sx]
      if ($bg[$sy * $W + $sx] -or ($lab -ne $o.label -and $lab -ne 0)) {
        $obytes[$di] = 0; $obytes[$di+1] = 0; $obytes[$di+2] = 0; $obytes[$di+3] = 0
      } else {
        $obytes[$di]   = $bytes[$si]
        $obytes[$di+1] = $bytes[$si+1]
        $obytes[$di+2] = $bytes[$si+2]
        $obytes[$di+3] = 255
      }
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($obytes, 0, $od.Scan0, $obytes.Length)
  $out.UnlockBits($od)

  $name = "{0}_{1:000}.png" -f $Prefix, $n
  $path = Join-Path $OutDir $name
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()

  $result += [pscustomobject]@{
    file = $name
    x = [int]($x0 / $Scale); y = [int]($y0 / $Scale)
    w = [int]($ow / $Scale); h = [int]($oh / $Scale)
    aspect = [math]::Round($ow / $oh, 3)
  }
  $n++
}

$bmp.Dispose()
$result | ConvertTo-Json -Compress
Write-Host ("sliced objects: {0} -> {1}" -f $n, $OutDir)
