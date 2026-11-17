$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System.Runtime.InteropServices;
public static class CaptureDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[CaptureDpi]::SetProcessDPIAware() | Out-Null
Start-Sleep -Milliseconds 150
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$form = [System.Windows.Forms.Form]::new()
$pen = [System.Drawing.Pen]::new([System.Drawing.SystemColors]::Highlight, 2)
try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $form.FormBorderStyle = 'None'
    $form.StartPosition = 'Manual'
    $form.Bounds = $bounds
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.KeyPreview = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Cross
    $form.BackgroundImage = $bitmap
    $form.Opacity = 0.7
    $script:captureStart = $null
    $script:captureRect = [System.Drawing.Rectangle]::Empty
    $form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $form.Close() } })
    $form.Add_MouseDown({
        if ($_.Button -eq 'Left') { $script:captureStart = $_.Location }
    })
    $form.Add_MouseMove({
        if ($null -ne $script:captureStart) {
            $script:captureRect = [System.Drawing.Rectangle]::FromLTRB(
                [Math]::Min($script:captureStart.X, $_.X),
                [Math]::Min($script:captureStart.Y, $_.Y),
                [Math]::Max($script:captureStart.X, $_.X),
                [Math]::Max($script:captureStart.Y, $_.Y))
            $form.Invalidate()
        }
    })
    $form.Add_Paint({
        if ($script:captureRect.Width -gt 0 -and $script:captureRect.Height -gt 0) {
            $_.Graphics.DrawRectangle($pen, $script:captureRect)
        }
    })
    $form.Add_MouseUp({
        if ($_.Button -ne 'Left' -or $null -eq $script:captureStart) { return }
        if ($script:captureRect.Width -gt 1 -and $script:captureRect.Height -gt 1) {
            $selection = $bitmap.Clone($script:captureRect, $bitmap.PixelFormat)
            try { $selection.Save($env:BYCODA_CAPTURE_PATH, [System.Drawing.Imaging.ImageFormat]::Png) }
            finally { $selection.Dispose() }
        }
        $form.Close()
    })
    [System.Windows.Forms.Application]::Run($form)
} finally {
    $form.Dispose()
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
