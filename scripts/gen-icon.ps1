Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

$r = 56
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r, $r, 180, 90)
$path.AddArc($size - $r, 0, $r, $r, 270, 90)
$path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
$path.AddArc(0, $size - $r, $r, $r, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0, 0)),
  (New-Object System.Drawing.Point($size, $size)),
  [System.Drawing.Color]::FromArgb(76, 110, 245),
  [System.Drawing.Color]::FromArgb(59, 91, 219))
$g.FillPath($brush, $path)

$font = New-Object System.Drawing.Font('Microsoft YaHei', 130, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sf.LineAlignment = 'Center'
$gong = [string][char]0x5DE5
$g.DrawString($gong, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, -8, $size, $size)), $sf)

New-Item -ItemType Directory -Force -Path 'C:\Users\xf\.zcode\workspace\default\workbench\resources' | Out-Null
$bmp.Save('C:\Users\xf\.zcode\workspace\default\workbench\resources\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output 'ICON_OK'
