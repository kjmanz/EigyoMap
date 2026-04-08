$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath

  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  return $path
}

function Draw-Icon {
  param(
    [int]$Size,
    [string]$OutputPath
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $graphics.Clear([System.Drawing.Color]::Transparent)

  $cornerRadius = $Size * 0.21
  $rounded = New-RoundedRectPath 0 0 $Size $Size $cornerRadius

  $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    [System.Drawing.RectangleF]::new(0, 0, $Size, $Size),
    [System.Drawing.Color]::FromArgb(29, 78, 216),
    [System.Drawing.Color]::FromArgb(37, 99, 235),
    45
  )
  $graphics.FillPath($gradient, $rounded)

  $graphics.SetClip($rounded)

  $gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(64, 191, 219, 254)), ($Size * 0.028)
  for ($i = 1; $i -le 4; $i++) {
    $y = $Size * (0.16 + ($i * 0.16))
    $graphics.DrawLine($gridPen, 0, $y, $Size, $y)
  }
  foreach ($xRatio in @(0.24, 0.5, 0.76)) {
    $x = $Size * $xRatio
    $graphics.DrawLine($gridPen, $x, 0, $x, $Size)
  }

  $routePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(112, 219, 234, 254)), ($Size * 0.039)
  $routePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $routePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $routePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $routePath.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.18, $Size * 0.67),
    [System.Drawing.PointF]::new($Size * 0.34, $Size * 0.45),
    [System.Drawing.PointF]::new($Size * 0.56, $Size * 0.73),
    [System.Drawing.PointF]::new($Size * 0.68, $Size * 0.5)
  )
  $routePath.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.68, $Size * 0.5),
    [System.Drawing.PointF]::new($Size * 0.78, $Size * 0.38),
    [System.Drawing.PointF]::new($Size * 0.85, $Size * 0.46),
    [System.Drawing.PointF]::new($Size * 0.9, $Size * 0.33)
  )
  $graphics.DrawPath($routePen, $routePath)

  $pinPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pinTop = $Size * 0.24
  $pinBottom = $Size * 0.82
  $pinLeft = $Size * 0.28
  $pinRight = $Size * 0.72
  $pinControlLeft = $Size * 0.19
  $pinControlRight = $Size * 0.81
  $pinTipX = $Size * 0.5
  $pinUpperY = $Size * 0.47

  $pinPath.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.5, $pinTop),
    [System.Drawing.PointF]::new($pinControlLeft, $pinTop),
    [System.Drawing.PointF]::new($pinLeft, $pinUpperY),
    [System.Drawing.PointF]::new($pinTipX, $pinBottom)
  )
  $pinPath.AddBezier(
    [System.Drawing.PointF]::new($pinTipX, $pinBottom),
    [System.Drawing.PointF]::new($pinRight, $pinUpperY),
    [System.Drawing.PointF]::new($pinControlRight, $pinTop),
    [System.Drawing.PointF]::new($Size * 0.5, $pinTop)
  )
  $pinPath.CloseFigure()

  $pinBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $graphics.FillPath($pinBrush, $pinPath)

  $centerRadius = $Size * 0.094
  $centerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(29, 78, 216))
  $graphics.FillEllipse(
    $centerBrush,
    ($Size * 0.5) - $centerRadius,
    ($Size * 0.455) - $centerRadius,
    $centerRadius * 2,
    $centerRadius * 2
  )

  $shineRadius = $Size * 0.023
  $shineBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 147, 197, 253))
  $graphics.FillEllipse(
    $shineBrush,
    ($Size * 0.537) - $shineRadius,
    ($Size * 0.418) - $shineRadius,
    $shineRadius * 2,
    $shineRadius * 2
  )

  $graphics.ResetClip()

  $directory = Split-Path -Parent $OutputPath
  if (-not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $routePath.Dispose()
  $routePen.Dispose()
  $gridPen.Dispose()
  $shineBrush.Dispose()
  $centerBrush.Dispose()
  $pinBrush.Dispose()
  $pinPath.Dispose()
  $gradient.Dispose()
  $rounded.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Convert-PngToIco {
  param(
    [string]$InputPath,
    [string]$OutputPath
  )

  $image = [System.Drawing.Image]::FromFile((Resolve-Path $InputPath))
  try {
    $directory = Split-Path -Parent $OutputPath
    if (-not (Test-Path $directory)) {
      New-Item -ItemType Directory -Path $directory | Out-Null
    }

    $image.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Icon)
  } finally {
    $image.Dispose()
  }
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$public = Join-Path $root "public"

Draw-Icon -Size 32 -OutputPath (Join-Path $public "favicon-32x32.png")
Convert-PngToIco -InputPath (Join-Path $public "favicon-32x32.png") -OutputPath (Join-Path $public "favicon.ico")
Draw-Icon -Size 180 -OutputPath (Join-Path $public "apple-touch-icon.png")
Draw-Icon -Size 192 -OutputPath (Join-Path $public "pwa-192.png")
Draw-Icon -Size 192 -OutputPath (Join-Path $public "pwa-192-maskable.png")
Draw-Icon -Size 512 -OutputPath (Join-Path $public "pwa-512.png")
Draw-Icon -Size 512 -OutputPath (Join-Path $public "pwa-512-maskable.png")

Write-Output "Generated favicon, ICO, and PWA icon assets in $public"
