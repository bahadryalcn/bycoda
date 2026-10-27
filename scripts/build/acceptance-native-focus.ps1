param([Parameter(Mandatory = $true)][string]$Run)
$ErrorActionPreference = 'Stop'
$acceptanceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$acceptanceRuns = [System.IO.Path]::GetFullPath((Join-Path $acceptanceRoot 'temp/build/managed-runs'))
function Assert-AcceptanceChild([string]$Path, [string]$Label) {
    $acceptancePath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).ProviderPath)
    if (-not $acceptancePath.StartsWith($acceptanceRuns + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing $Label outside this checkout's managed development runs"
    }
    return $acceptancePath
}
$acceptanceRecordPath = Assert-AcceptanceChild $Run 'run record'
$acceptanceRecord = Get-Content -LiteralPath $acceptanceRecordPath -Raw | ConvertFrom-Json
if ((Split-Path -Leaf $acceptanceRecord.desktopDataPath) -notmatch '^com\.bycoda\.desktop\.dev\.[a-f0-9]{20}$') {
    throw 'Refusing a non-development desktop profile'
}
$acceptanceDigest = [Security.Cryptography.SHA256]::Create()
try {
    $acceptanceHash = -join ($acceptanceDigest.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$acceptanceRecord.instanceId)) | ForEach-Object { $_.ToString('x2') })
} finally { $acceptanceDigest.Dispose() }
$acceptanceProfile = 'com.bycoda.desktop.dev.' + $acceptanceHash.Substring(0, 20)
$acceptanceExpectedDesktop = [IO.Path]::GetFullPath((Join-Path $env:APPDATA $acceptanceProfile))
if (-not [string]::Equals([IO.Path]::GetFullPath($acceptanceRecord.desktopDataPath), $acceptanceExpectedDesktop, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing an unexpected development desktop profile'
}
$acceptanceHostData = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $acceptanceRecord.hostDataPath).ProviderPath)
$acceptanceProfileHost = [IO.Path]::GetFullPath((Join-Path $acceptanceExpectedDesktop 'host'))
if (-not [string]::Equals($acceptanceHostData, $acceptanceProfileHost, [StringComparison]::OrdinalIgnoreCase)) {
    $null = Assert-AcceptanceChild $acceptanceHostData 'Host data'
}
$acceptanceExecutable = Assert-AcceptanceChild $acceptanceRecord.executable 'executable'
$acceptanceManifestPath = Assert-AcceptanceChild $acceptanceRecord.buildManifest 'build manifest'
$acceptanceManifest = Get-Content -LiteralPath $acceptanceManifestPath -Raw | ConvertFrom-Json
if ($acceptanceManifest.channel -ne 'dev') { throw 'Refusing a non-development build' }
$acceptanceProcess = Get-Process -Id ([int]$acceptanceRecord.pid) -ErrorAction Stop
if (-not [string]::Equals($acceptanceProcess.Path, $acceptanceExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The recorded PID is not running this isolated development executable'
}
$acceptanceShell = New-Object -ComObject WScript.Shell
$null = $acceptanceShell.AppActivate([int]$acceptanceProcess.Id)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeAcceptanceFocus {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
    public static uint ForegroundProcessId() {
        uint process;
        GetWindowThreadProcessId(GetForegroundWindow(), out process);
        return process;
    }
    public static bool ActivateOwnedWindow(IntPtr window, uint expectedProcess) {
        uint targetProcess;
        uint target = GetWindowThreadProcessId(window, out targetProcess);
        if (window == IntPtr.Zero || target == 0 || targetProcess != expectedProcess) return false;
        uint ignored;
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint caller = GetCurrentThreadId();
        bool attachedForeground = false;
        bool attachedTarget = false;
        try {
            ShowWindowAsync(window, 9);
            if (foreground != 0 && foreground != caller)
                attachedForeground = AttachThreadInput(caller, foreground, true);
            if (target != caller && target != foreground)
                attachedTarget = AttachThreadInput(caller, target, true);
            BringWindowToTop(window);
            SetForegroundWindow(window);
            return ForegroundProcessId() == expectedProcess;
        } finally {
            if (attachedTarget) AttachThreadInput(caller, target, false);
            if (attachedForeground) AttachThreadInput(caller, foreground, false);
        }
    }
}
'@
$acceptanceProcess.Refresh()
$acceptanceWindow = $acceptanceProcess.MainWindowHandle
if ($acceptanceWindow -eq [IntPtr]::Zero) { throw 'The verified development process has no main window' }
for ($acceptanceAttempt = 0; $acceptanceAttempt -lt 8; $acceptanceAttempt++) {
    if ([NativeAcceptanceFocus]::ForegroundProcessId() -eq [uint32]$acceptanceProcess.Id) { break }
    $null = [NativeAcceptanceFocus]::ActivateOwnedWindow($acceptanceWindow, [uint32]$acceptanceProcess.Id)
    Start-Sleep -Milliseconds 80
}
$acceptanceForeground = [NativeAcceptanceFocus]::ForegroundProcessId()
if ($acceptanceForeground -ne [uint32]$acceptanceProcess.Id) {
    throw "Windows foreground activation failed: expected development PID $($acceptanceProcess.Id), observed PID $acceptanceForeground"
}
Write-Output "Verified foreground development PID $acceptanceForeground"
