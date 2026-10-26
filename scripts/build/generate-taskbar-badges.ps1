# Windows taskbar overlays: regenerate with Windows' Segoe UI font.
# These native assets use the shared light danger solid (#b91c1c) and white ink.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$destination = Join-Path $PSScriptRoot '../../src-tauri/icons/taskbar-badges.png'
$scale = 4
$size = 32
$atlas = [System.Drawing.Bitmap]::new($size * 10, $size)
$atlasGraphics = [System.Drawing.Graphics]::FromImage($atlas)
try {
    for ($index = 0; $index -lt 10; $index++) {
        $tile = [System.Drawing.Bitmap]::new($size * $scale, $size * $scale)
        $graphics = [System.Drawing.Graphics]::FromImage($tile)
        $fill = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#b91c1c'))
        $outline = [System.Drawing.Pen]::new([System.Drawing.Color]::White, $scale)
        $label = if ($index -eq 9) { '9+' } else { [string]($index + 1) }
        $fontSize = if ($index -eq 9) { 15 } else { 21 }
        $font = [System.Drawing.Font]::new('Segoe UI', $fontSize * $scale, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
        try {
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
            $graphics.FillEllipse($fill, 2 * $scale, 2 * $scale, 28 * $scale, 28 * $scale)
            $graphics.DrawEllipse($outline, 2 * $scale, 2 * $scale, 28 * $scale, 28 * $scale)
            $format.Alignment = [System.Drawing.StringAlignment]::Center
            $format.LineAlignment = [System.Drawing.StringAlignment]::Center
            $bounds = [System.Drawing.RectangleF]::new(0, -0.5 * $scale, $size * $scale, $size * $scale)
            $graphics.DrawString($label, $font, [System.Drawing.Brushes]::White, $bounds, $format)
            $atlasGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $atlasGraphics.DrawImage($tile, [System.Drawing.Rectangle]::new($index * $size, 0, $size, $size), 0, 0, $tile.Width, $tile.Height, [System.Drawing.GraphicsUnit]::Pixel)
        } finally {
            $format.Dispose()
            $font.Dispose()
            $outline.Dispose()
            $fill.Dispose()
            $graphics.Dispose()
            $tile.Dispose()
        }
    }
    $atlasGraphics.Flush()
    # Resampling can leave faint pixels outside the disc. Keep a clear gutter
    # around every tile so Windows cannot pick up a fringe when scaling it.
    $clear = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)
    for ($index = 0; $index -lt 10; $index++) {
        for ($offset = 0; $offset -lt $size; $offset++) {
            $atlas.SetPixel($index * $size + $offset, 0, $clear)
            $atlas.SetPixel($index * $size + $offset, $size - 1, $clear)
            $atlas.SetPixel($index * $size, $offset, $clear)
            $atlas.SetPixel(($index + 1) * $size - 1, $offset, $clear)
        }
    }
    $atlas.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $atlasGraphics.Dispose()
    $atlas.Dispose()
}
