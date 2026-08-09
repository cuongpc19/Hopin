# Draw the game title onto the three store covers.
#
# CrazyGames REQUIRE the title on the cover ("Put the name of your game directly on the
# cover"), and forbid everything else — no "New"/"Play" tags, no borders, no store logos.
#
# Done in PowerShell rather than sharp because the title has to be set in the game's own
# font (public/fonts/LilitaOne.ttf) and sharp's SVG renderer cannot reliably load a font
# file that is not installed system-wide. .NET's PrivateFontCollection loads it straight
# off disk, so the covers match the LEVEL COMPLETE banner in game.
#
# Style copies the in-game level pill: white fill, thick warm-brown outline, soft shadow.
#
#   powershell -File scripts/title-covers.ps1

Add-Type -AssemblyName System.Drawing

$root  = Split-Path -Parent $PSScriptRoot
$font  = Join-Path $root "public\fonts\LilitaOne.ttf"
$dir   = Join-Path $root "store\crazygames"
$title = "Hop In!"

if (-not (Test-Path $font)) { Write-Error "Khong thay font: $font"; exit 1 }

$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile($font)
$family = $pfc.Families[0]

# size    = cap height as a fraction of image height
# yFrac   = where the cap sits vertically (fraction of height)
$jobs = @(
  @{ file = "cover-landscape-1920x1080.jpg"; size = 0.115; yFrac = 0.10 },
  @{ file = "cover-portrait-800x1200.jpg";   size = 0.085; yFrac = 0.045 },
  @{ file = "cover-square-800x800.jpg";      size = 0.110; yFrac = 0.055 }
)

foreach ($j in $jobs) {
  $path = Join-Path $dir $j.file
  if (-not (Test-Path $path)) { Write-Warning "bo qua (khong co): $($j.file)"; continue }

  $src = [System.Drawing.Image]::FromFile($path)
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $src.Dispose()

  $em = [float]($bmp.Height * $j.size)

  # GraphicsPath, not DrawString: an outline this thick has to be STROKED around the
  # glyphs. DrawString would only ever give a flat fill with no edge.
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sf = [System.Drawing.StringFormat]::GenericTypographic
  $sf.Alignment     = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Near
  $rect = New-Object System.Drawing.RectangleF 0, ([float]($bmp.Height * $j.yFrac)), ([float]$bmp.Width), ([float]$em * 2)
  $gp.AddString($title, $family, [int][System.Drawing.FontStyle]::Regular, $em, $rect, $sf)

  # Soft shadow first, so the title holds up over both grass and sky.
  $shadow = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shadow.AddString($title, $family, [int][System.Drawing.FontStyle]::Regular, $em, `
    (New-Object System.Drawing.RectangleF 0, ([float]($bmp.Height * $j.yFrac + $em * 0.07)), ([float]$bmp.Width), ([float]$em * 2)), $sf)
  $sBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
  $g.FillPath($sBrush, $shadow)

  # Outline, then fill — same warm brown and white as the in-game level pill.
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 138, 90, 18)), ([float]($em * 0.155))
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($pen, $gp)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), $gp)

  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
  $prm = New-Object System.Drawing.Imaging.EncoderParameters 1
  $prm.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 94L
  $out = Join-Path $dir ("titled_" + $j.file)
  $bmp.Save($out, $enc, $prm)

  $g.Dispose(); $bmp.Dispose(); $gp.Dispose(); $shadow.Dispose()
  Move-Item -Force $out $path
  Write-Host ("  da ghi ten len: " + $j.file)
}
$pfc.Dispose()
