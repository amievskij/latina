# Рисует иконки приложения (буква «ā» на тёмно-красном фоне).
Add-Type -AssemblyName System.Drawing
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
New-Item -ItemType Directory -Force $dir | Out-Null

function New-Icon([int]$size, [string]$name, [double]$glyph, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(154, 47, 42))
  if ($rounded) {
    $r = [int]($size * 0.22); $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.FillPath($bg, $path)
  } else {
    $g.FillRectangle($bg, 0, 0, $size, $size)
  }
  $font = New-Object System.Drawing.Font 'Georgia', ([single]($size * $glyph)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(250, 244, 232))
  $rect = New-Object System.Drawing.RectangleF 0, ([single](-$size * 0.04)), $size, $size
  $g.DrawString([string][char]0x0101, $font, $fg, $rect, $fmt)
  $g.Dispose()
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

New-Icon 192 'icon-192.png' 0.62 $true
New-Icon 512 'icon-512.png' 0.62 $true
New-Icon 512 'icon-maskable-512.png' 0.46 $false
New-Icon 180 'apple-touch-icon.png' 0.58 $false
Get-ChildItem $dir | Select-Object Name, Length
