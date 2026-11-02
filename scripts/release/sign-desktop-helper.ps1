param(
    [Parameter(Mandatory=$true)][string]$BinaryPath,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$CertificateThumbprint,
    [ValidateSet('CurrentUser','LocalMachine')][string]$StoreLocation='CurrentUser'
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
$binary=Get-Item -LiteralPath $BinaryPath
if ($binary.PSIsContainer -or ($binary.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The helper signing input must be a regular file.' }
if ((Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash -ine $ExpectedSha256) { throw 'The pinned helper changed before signing.' }
$signTool=Get-Command signtool.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $signTool) {
    $sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path -LiteralPath $sdkRoot) {
        $signTool=Get-ChildItem -LiteralPath $sdkRoot -Directory |
            Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
            Sort-Object { [version]$_.Name } -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
    }
}
if (-not $signTool) { throw 'Windows SDK SignTool.exe is required to sign the desktop helper.' }
# The TSA publishes this RFC3161 endpoint; the returned timestamp is verified.
# https://knowledge.digicert.com/solution/troubleshooting-timestamping-problems
$signArguments=@('sign','/q','/fd','SHA256','/sha1',$CertificateThumbprint,'/s','My','/tr','http://timestamp.digicert.com','/td','SHA256')
if ($StoreLocation -eq 'LocalMachine') { $signArguments+='/sm' }
$signArguments+=$binary.FullName
$null=& $signTool @signArguments 2>&1
if ($LASTEXITCODE -ne 0) { throw "Desktop helper signing failed (SignTool exit $LASTEXITCODE)." }
$null=& $signTool verify /q /pa /all /tw $binary.FullName 2>&1
if ($LASTEXITCODE -ne 0) { throw "Desktop helper signature verification failed (SignTool exit $LASTEXITCODE)." }
$signature=Get-AuthenticodeSignature -LiteralPath $binary.FullName
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $CertificateThumbprint -or -not $signature.TimeStamperCertificate) { throw 'The desktop helper signature or timestamp does not match the selected certificate.' }
@{status='Valid';signerThumbprint=$signature.SignerCertificate.Thumbprint;timestamped=$true;sha256=(Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Compress
