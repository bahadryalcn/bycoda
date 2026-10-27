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
$null = Assert-AcceptanceChild $acceptanceRecord.hostDataPath 'Host data'
$acceptanceExecutable = Assert-AcceptanceChild $acceptanceRecord.executable 'executable'
$acceptanceManifestPath = Assert-AcceptanceChild $acceptanceRecord.buildManifest 'build manifest'
$acceptanceManifest = Get-Content -LiteralPath $acceptanceManifestPath -Raw | ConvertFrom-Json
if ($acceptanceManifest.channel -ne 'dev') { throw 'Refusing a non-development build' }
$acceptanceProcess = Get-Process -Id ([int]$acceptanceRecord.pid) -ErrorAction Stop
if (-not [string]::Equals($acceptanceProcess.Path, $acceptanceExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The recorded PID is not running this isolated development executable'
}
$acceptanceShell = New-Object -ComObject WScript.Shell
if (-not $acceptanceShell.AppActivate([int]$acceptanceProcess.Id)) {
    throw 'Windows could not activate the isolated development PID'
}
Write-Output 'Activated the verified isolated development PID'
