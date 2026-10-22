param(
    [string]$Version,
    [switch]$Plan,
    [switch]$InstallOnly,
    [switch]$BuildOnly,
    [switch]$Release,
    [switch]$ForceBuild,
    [switch]$Status,
    [string]$SnapshotRequest,
    [string]$BaseSnapshot,
    [string[]]$SourcePaths,
    [string[]]$Platforms = @('windows', 'mac'),
    [ValidateSet('host', 'app')][string[]]$Components = @('host', 'app')
)
$ErrorActionPreference = 'Stop'
$arguments = @('-B', (Join-Path $PSScriptRoot 'local-update/local_update.py'), '--platforms', ($Platforms -join ','))
$arguments += @('--components', ($Components -join ','))
if ($Version) { $arguments += @('--version', $Version) }
if ($Plan) { $arguments += '--plan' }
if ($InstallOnly) { $arguments += '--install-only' }
if ($BuildOnly) { $arguments += '--build-only' }
if ($Release) { $arguments += '--release' }
if ($ForceBuild) { $arguments += '--force-build' }
if ($Status) { $arguments += '--status' }
if ($SnapshotRequest) { $arguments += @('--snapshot-request', $SnapshotRequest) }
if ($BaseSnapshot) { $arguments += @('--base-snapshot', $BaseSnapshot) }
foreach ($sourcePath in $SourcePaths) { $arguments += @('--source-path', $sourcePath) }
& python @arguments
if ($LASTEXITCODE -ne 0) { throw "Local update failed ($LASTEXITCODE). See the printed log path." }
