#Requires -Version 5.1
<#
Fresh dedicated Hyper-V guest tool bootstrap. Plan performs no writes/network.
Install and SeedRunnerCache require the actual VM UUID, local BycodaAdmin,
elevation and its exact dedicated profile. Never creates users, registers a
runner, starts a service, restarts Windows, or falls back to a host/user profile.
Initial Windows PowerShell 5.1 works before PowerShell 7 is installed.
#>
[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Install', 'SeedRunnerCache')][string]$Mode = 'Plan',
    [string]$ExpectedVmUuid,
    [switch]$IncludePython,
    [switch]$IncludePnpm
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# A Desktop PowerShell child can inherit a PowerShell 7 module path. Keep its
# native modules local to this process; never persist a machine/user override.
if ($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
$BootstrapRoot = 'C:\ProgramData\BycodaCI-GuestBootstrap'
$StateRoot = "$BootstrapRoot\newroot"
$ToolsRoot = "$BootstrapRoot\tools"
$CargoHome = "$ToolsRoot\cargo"
$RustupHome = "$ToolsRoot\rustup"
$GuestAccount = 'BycodaAdmin'
$BootstrapSchema = 1

function Get-GuestToolManifest {
    # Exact metadata verified 2026-10-28. Hashes are checked before any execution.
    # Microsoft fixed bootstrap URL embeds its SHA256; Microsoft Authenticode is
    # additionally mandatory for VS/WebView2. No moving aka.ms installer is run.
    return @(
        [pscustomobject]@{ id='node'; version='24.22.1'; filename='node-v24.22.1-x64.msi'; sha256='3bda4baf1ee709b33cf920dd633106ddb23951e322bff9c03ec9f64ab8981b01'; url='https://nodejs.org/dist/v24.22.1/node-v24.22.1-x64.msi'; source='https://nodejs.org/dist/v24.22.1/SHASUMS256.txt'; maxBytes=104857600; optional=$false; microsoftSignature=$false }
        [pscustomobject]@{ id='powershell'; version='7.6.9'; filename='PowerShell-7.6.9-win-x64.msi'; sha256='50d33c7494aaf82b987cfd4de3f232d04f91fdd4c0deeca8a669cced3e7cf8f9'; url='https://github.com/PowerShell/PowerShell/releases/download/v7.6.9/PowerShell-7.6.9-win-x64.msi'; source='https://api.github.com/repos/PowerShell/PowerShell/releases/tags/v7.6.9'; maxBytes=209715200; optional=$false; microsoftSignature=$true }
        [pscustomobject]@{ id='git'; version='2.56.0.4'; filename='Git-2.56.0.4-64-bit.exe'; sha256='4961a4a8cc778d8b6e00a5819e5fe4d078b754555aff7aedc2d77a5d74c2de80'; url='https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/Git-2.56.0.4-64-bit.exe'; source='https://api.github.com/repos/git-for-windows/git/releases/tags/v2.56.0.windows.4'; maxBytes=125829120; optional=$false; microsoftSignature=$false }
        [pscustomobject]@{ id='msvc'; version='17.14.43'; buildVersion='17.14.37824.6'; filename='vs_BuildTools.exe'; sha256='dbea89df9de387e415075d40d713ecc1a73091d03e81080c3a957101f390f499'; url='https://download.visualstudio.microsoft.com/download/pr/4bc08c27-bd31-470c-9a30-3b62707fbf0f/dbea89df9de387e415075d40d713ecc1a73091d03e81080c3a957101f390f499/vs_BuildTools.exe'; source='https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history'; maxBytes=16777216; optional=$false; microsoftSignature=$true }
        [pscustomobject]@{ id='rust'; version='1.99.1'; bootstrapVersion='1.29.2'; filename='rustup-init.exe'; sha256='00f139da614dced87d3c3d4121c43eebdac3c1bf8a5ee86b9d80dfd71c8d70fd'; url='https://static.rust-lang.org/rustup/archive/1.29.2/x86_64-pc-windows-msvc/rustup-init.exe'; source='https://static.rust-lang.org/rustup/archive/1.29.2/x86_64-pc-windows-msvc/rustup-init.exe.sha256'; maxBytes=33554432; optional=$false; microsoftSignature=$false }
        [pscustomobject]@{ id='webview2'; version='156.0.4314.50'; filename='MicrosoftEdgeWebView2RuntimeInstallerX64.exe'; sha256='1c401b327fbc7bb9731b4e350a2194f083cbc3ede46508d52e1cae6610a39bea'; url='https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/f699d81e-69ce-4b09-aa07-23ff2713045b/MicrosoftEdgeWebView2RuntimeInstallerX64.exe'; source='https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/m/Microsoft/EdgeWebView2Runtime/156.0.4314.50/Microsoft.EdgeWebView2Runtime.installer.yaml'; maxBytes=314572800; optional=$false; microsoftSignature=$true }
        [pscustomobject]@{ id='python'; version='3.14.10'; filename='python-3.14.10-amd64.exe'; sha256='92480239264744fe0386a1bd8275786fefa126e3129e56a68e22b52c73329965'; url='https://www.python.org/ftp/python/3.14.10/python-3.14.10-amd64.exe'; source='https://www.python.org/downloads/release/python-31410/'; maxBytes=67108864; optional=$true; microsoftSignature=$false }
        [pscustomobject]@{ id='pnpm'; version='12.15.0'; filename='pnpm-win32-x64.zip'; sha256='84cf69db1be19e95bb4e5bef329291a046f2821b390d87e00f5690809d8a2ed7'; url='https://github.com/pnpm/pnpm/releases/download/v12.15.0/pnpm-win32-x64.zip'; source='https://api.github.com/repos/pnpm/pnpm/releases/tags/v12.15.0'; maxBytes=67108864; optional=$true; microsoftSignature=$false }
    )
}

function Assert-GuestManifest($Manifest) {
    $ids = @{}
    foreach ($tool in $Manifest) {
        if ($ids.ContainsKey($tool.id) -or $tool.id -notin @('node','powershell','git','msvc','rust','webview2','python','pnpm')) { throw 'Invalid or duplicate tool identity.' }
        $ids[$tool.id] = $true
        $uri = [uri]$tool.url
        if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.Host -notin @('nodejs.org','github.com','download.visualstudio.microsoft.com','static.rust-lang.org','msedge.sf.dl.delivery.mp.microsoft.com','www.python.org')) { throw 'Nonofficial tool download URL.' }
        if ($tool.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $tool.version -cnotmatch '^\d+\.\d+\.\d+(\.\d+)?$' -or $tool.filename -cnotmatch '^[a-zA-Z0-9_.-]+$' -or $tool.maxBytes -lt 1048576 -or $tool.maxBytes -gt 536870912) { throw 'Unbounded or unpinned tool manifest.' }
        if ([IO.Path]::GetFileName($uri.AbsolutePath) -cne $tool.filename) { throw 'Tool filename and URL differ.' }
    }
    if ($ids.Count -ne 8) { throw 'Incomplete guest tool manifest.' }
}

function Test-GuestNoReparse([string]$Path) {
    if ($Path -notmatch '^[a-zA-Z]:[\\/]' -or $Path.StartsWith('\\') -or $Path.Substring(2).Contains(':')) { return $false }
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -Force -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
    return $true
}

function Get-GuestFacts {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $computer = Get-CimInstance Win32_ComputerSystem
    $product = Get-CimInstance Win32_ComputerSystemProduct
    $bios = Get-CimInstance Win32_BIOS
    return [pscustomobject]@{
        manufacturer = [string]$computer.Manufacturer; model = [string]$computer.Model
        biosManufacturer = [string]$bios.Manufacturer; vmUuid = [string]$product.UUID
        computerName = [string]$computer.Name; identity = $identity.Name; sid = $identity.User.Value
        elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        profile = [Environment]::GetFolderPath('UserProfile'); os64 = [Environment]::Is64BitOperatingSystem
        process64 = [Environment]::Is64BitProcess
        hyperVIntegration = [bool](Get-Service -Name vmicheartbeat -ErrorAction SilentlyContinue)
    }
}

function Get-GuestDenials($Facts, [string]$VmUuid) {
    $denials = [Collections.Generic.List[string]]::new()
    if ($Facts.manufacturer -ne 'Microsoft Corporation' -or $Facts.model -ne 'Virtual Machine' -or $Facts.biosManufacturer -ne 'Microsoft Corporation' -or -not $Facts.hyperVIntegration) { $denials.Add('actual-microsoft-hyper-v-guest-required') }
    $actual = [guid]::Empty; $expected = [guid]::Empty
    if (-not [guid]::TryParse($Facts.vmUuid, [ref]$actual) -or $actual -eq [guid]::Empty -or -not [guid]::TryParse($VmUuid, [ref]$expected) -or $expected -eq [guid]::Empty -or $actual -ne $expected) { $denials.Add('exact-new-vm-uuid-required') }
    if ($Facts.identity -ine "$($Facts.computerName)\BycodaAdmin" -or $Facts.profile.TrimEnd('\') -ine 'C:\Users\BycodaAdmin' -or $Facts.sid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { $denials.Add('dedicated-local-BycodaAdmin-profile-required') }
    if (-not $Facts.elevated) { $denials.Add('guest-administrator-elevation-required') }
    if (-not $Facts.os64 -or -not $Facts.process64) { $denials.Add('64-bit-Windows-PowerShell-required') }
    return $denials.ToArray()
}

function Assert-ActualGuest([string]$VmUuid) {
    $facts = Get-GuestFacts
    $denials = @(Get-GuestDenials $facts $VmUuid)
    if ($denials.Count) { throw "Guest bootstrap denied before writes/network: $($denials -join ', ')." }
    foreach ($folder in @($BootstrapRoot, $StateRoot, $ToolsRoot, $CargoHome, $RustupHome, 'C:\Program Files', 'C:\Program Files (x86)')) {
        if (-not (Test-GuestNoReparse $folder)) { throw 'Guest bootstrap path traverses a reparse point.' }
    }
    if (Test-Path -LiteralPath 'C:\bycoda-actions\agent\.runner') { throw 'Tool bootstrap/cache seeding must precede runner registration.' }
    return $facts
}

function Get-GuestSha([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Write-GuestJson([string]$Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false)) }
function Get-GuestEffectiveFileRights($Rule) {
    # InheritOnly applies to descendants, never this object. Existing children
    # retain their own effective ACLs; do not confuse a Creator Owner template
    # on a parent with permission to mutate that parent.
    if ($Rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { return [long]0 }
    [long]$raw = $Rule.FileSystemRights
    if ($raw -lt 0) { $raw += 4294967296 }
    [long]$mapped = $raw -band 0x0fffffff
    # Windows FILE_GENERIC_READ/WRITE/EXECUTE and FILE_ALL_ACCESS (winnt.h).
    if ($raw -band 0x80000000L) { $mapped = $mapped -bor 0x120089 }
    if ($raw -band 0x40000000L) { $mapped = $mapped -bor 0x120116 }
    if ($raw -band 0x20000000L) { $mapped = $mapped -bor 0x1200a0 }
    if ($raw -band 0x10000000L) { $mapped = $mapped -bor 0x1f01ff }
    return $mapped
}
function Assert-GuestAcl($Acl, [string]$RunnerSid) {
    $owner = $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-32-544','S-1-5-18')) { throw 'Guest state must be Administrators/SYSTEM owned.' }
    # Modify contains read/execute bits. Only actual mutation rights belong here.
    $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    $authority = [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    $writers = @('S-1-5-32-544','S-1-5-18')
    if ($RunnerSid) { $writers += $RunnerSid }
    foreach ($ace in $Acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $effective = Get-GuestEffectiveFileRights $ace
        if ($ace.AccessControlType -eq 'Allow' -and ($effective -band $write) -and $ace.IdentityReference.Value -notin $writers) { throw 'Unexpected principal can mutate guest state.' }
        if ($RunnerSid -and $ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -eq $RunnerSid -and ($effective -band $authority)) { throw 'Runner may not change cache permissions or ownership.' }
    }
}
function Assert-GuestProtected([string]$Path, [string]$RunnerSid) {
    if (-not (Test-GuestNoReparse $Path)) { throw 'Protected guest state traverses a reparse point.' }
    Assert-GuestAcl (Get-Acl -LiteralPath $Path) $RunnerSid
}
function Protect-BootstrapRoot {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-32-544','S-1-5-18')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $BootstrapRoot -AclObject $acl
}
function Initialize-GuestState($Facts) {
    $marker = "$StateRoot\machine.json"
    if (Test-Path -LiteralPath $marker) {
        $previous = Get-Content -Raw -LiteralPath $marker | ConvertFrom-Json
        if ($previous.schemaVersion -ne $BootstrapSchema -or $previous.vmUuid -ine $Facts.vmUuid -or $previous.accountSid -ne $Facts.sid) { throw 'Existing bootstrap state belongs to another VM/account.' }
    } elseif ((Test-Path -LiteralPath $StateRoot) -or (Test-Path -LiteralPath $ToolsRoot)) { throw 'Unowned existing guest tool state must be reviewed.' }
    if (-not (Test-Path -LiteralPath $BootstrapRoot)) { New-Item -ItemType Directory -Path $BootstrapRoot | Out-Null }
    Protect-BootstrapRoot
    foreach ($folder in @($StateRoot, $ToolsRoot)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    foreach ($folder in @($BootstrapRoot,$StateRoot,$ToolsRoot)) { Assert-GuestProtected $folder }
    if (-not (Test-Path -LiteralPath $marker)) { Write-GuestJson $marker ([ordered]@{schemaVersion=$BootstrapSchema;vmUuid=$Facts.vmUuid;accountSid=$Facts.sid;createdAt=[DateTime]::UtcNow.ToString('o')}) }
    $run = "$StateRoot\runs\$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $run | Out-Null
    return $run
}

function Quote-GuestArgument([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Get-GuestMsiCommandLine([string[]]$Arguments) {
    # msiexec interprets the raw command line itself. CRT/Node argv quoting is
    # insufficient: switches stay bare and only property VALUES are quoted.
    # https://learn.microsoft.com/windows/win32/msi/setting-public-property-values-on-the-command-line
    if ($Arguments.Count -lt 6 -or $Arguments[0] -cne '/i') { throw 'Only bounded quiet MSI installation arguments are supported.' }
    $quoteLiteral = {
        param([string]$Value)
        if (-not $Value -or $Value -cmatch '["\x00-\x1f]') { throw 'Unsafe MSI literal.' }
        return '"' + $Value + '"'
    }
    $package = $Arguments[1]
    if ($package -cnotmatch '^[a-zA-Z]:[\\/].+\.msi$') { throw 'MSI package must have an absolute local .msi path.' }
    $parts = [Collections.Generic.List[string]]::new()
    $parts.Add('/i'); $parts.Add((& $quoteLiteral $package))
    $seen = @{}
    $propertyValues = @{INSTALLDIR='C:\Program Files\nodejs';ADD_PATH='1';ENABLE_PSREMOTING='0';USE_MU='0';ENABLE_MU='0'}
    for ($index=2; $index -lt $Arguments.Count; $index++) {
        $argument = $Arguments[$index]
        if ($argument -cin @('/qn','/norestart','/L*v')) {
            if ($seen.ContainsKey($argument)) { throw 'Duplicate MSI switch.' }
            $seen[$argument]=$true; $parts.Add($argument)
            if ($argument -ceq '/L*v') {
                $index++
                if ($index -ge $Arguments.Count -or $Arguments[$index] -cnotmatch '^[a-zA-Z]:[\\/].+\.log$') { throw 'MSI installation requires an absolute existing log directory.' }
                $parts.Add((& $quoteLiteral $Arguments[$index]))
            }
        } elseif ($argument -cmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
            $name=$Matches[1]; $value=$Matches[2]
            if (-not $propertyValues.ContainsKey($name) -or $value -cne $propertyValues[$name] -or $seen.ContainsKey($name)) { throw 'Unknown, duplicate or unsafe MSI property.' }
            $seen[$name]=$true; $parts.Add(($name + '=' + (& $quoteLiteral $value)))
        } else { throw 'Unsupported MSI argument; interactive/repair/restart flags are forbidden.' }
    }
    foreach ($required in @('/qn','/norestart','/L*v')) { if (-not $seen.ContainsKey($required)) { throw 'MSI quiet, no-restart and logging switches are mandatory.' } }
    return $parts -join ' '
}
function Get-GuestProcessCommandLine([string]$File, [string[]]$Arguments) {
    $msiexec = [IO.Path]::GetFullPath("$env:WINDIR\System32\msiexec.exe")
    if ([string]::Equals([IO.Path]::GetFullPath($File),$msiexec,[StringComparison]::OrdinalIgnoreCase)) {
        return Get-GuestMsiCommandLine $Arguments
    }
    return (($Arguments | ForEach-Object { Quote-GuestArgument $_ }) -join ' ')
}
function Invoke-GuestProcess([string]$File, [string[]]$Arguments, [int]$TimeoutSeconds=120, [string]$LogPrefix) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf) -or -not (Test-GuestNoReparse $File)) { throw "Missing/untrusted guest executable: $File" }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File; $info.Arguments = Get-GuestProcessCommandLine $File $Arguments
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.WindowStyle = 'Hidden'
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.EnvironmentVariables['CARGO_HOME'] = $CargoHome
    $info.EnvironmentVariables['RUSTUP_HOME'] = $RustupHome
    $info.EnvironmentVariables['RUSTUP_AUTO_INSTALL'] = '0'
    # Exact Rustup 1.29.2 setting (the newer main branch uses a different name).
    $info.EnvironmentVariables['RUSTUP_HARDLINK_PROXIES'] = '1'
    if ($LogPrefix) { $info.EnvironmentVariables['TEMP'] = Split-Path -Parent $LogPrefix; $info.EnvironmentVariables['TMP'] = Split-Path -Parent $LogPrefix }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $evidence = [ordered]@{schemaVersion=1;file=$File;arguments=$info.Arguments;pid=$null;startedAt=[DateTime]::UtcNow.ToString('o');completedAt=$null;timeoutSeconds=$TimeoutSeconds;status='starting';exitCode=$null;error=$null}
    if ($LogPrefix) { Write-GuestJson "$LogPrefix.process.json" $evidence }
    try {
        [void]$process.Start(); $evidence.pid=$process.Id; $evidence.status='running'
        if ($LogPrefix) { Write-GuestJson "$LogPrefix.process.json" $evidence }
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $evidence.status='timed-out'
            # Only this freshly spawned guest installer's process tree is eligible.
            $kill = [Diagnostics.ProcessStartInfo]::new(); $kill.FileName = "$env:WINDIR\System32\taskkill.exe"; $kill.Arguments = "/PID $($process.Id) /T /F"; $kill.UseShellExecute = $false; $kill.CreateNoWindow = $true; $kill.WindowStyle = 'Hidden'
            $killer = [Diagnostics.Process]::Start($kill); [void]$killer.WaitForExit(15000); $killer.Dispose()
            throw "Guest tool process exceeded its ${TimeoutSeconds}s bound."
        }
        $evidence.exitCode=$process.ExitCode
        # A surviving descendant can retain stdout/stderr handles after the root
        # process exits. Never wait indefinitely for those unrelated handles.
        if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout,$stderr),5000)) { throw 'Guest process exited but output handles did not close within 5 seconds.' }
        $out = $stdout.GetAwaiter().GetResult(); $err = $stderr.GetAwaiter().GetResult()
        if ($out.Length -gt 1048576 -or $err.Length -gt 1048576) { throw 'Guest process output exceeded 1MiB evidence bound.' }
        if ($LogPrefix) { [IO.File]::WriteAllText("$LogPrefix.stdout.log",$out); [IO.File]::WriteAllText("$LogPrefix.stderr.log",$err) }
        $evidence.status='exited'
        return [pscustomobject]@{exitCode=$process.ExitCode;stdout=$out.Trim();stderr=$err.Trim()}
    } catch { if ($evidence.status -ne 'timed-out') {$evidence.status='failed'}; $evidence.error=$_.Exception.Message; throw }
    finally { $evidence.completedAt=[DateTime]::UtcNow.ToString('o'); if ($LogPrefix) {Write-GuestJson "$LogPrefix.process.json" $evidence}; $process.Dispose() }
}

function Test-GuestArtifact($Tool, [string]$Path) {
    if (-not (Test-GuestNoReparse $Path)) { throw 'Downloaded artifact is a reparse point.' }
    $file = Get-Item -Force -LiteralPath $Path
    if ($file.PSIsContainer -or $file.Length -le 0 -or $file.Length -gt $Tool.maxBytes -or (Get-GuestSha $Path) -cne $Tool.sha256) { throw 'Downloaded artifact size/hash mismatch.' }
    if ($Tool.microsoftSignature) {
        $signature = Get-AuthenticodeSignature -LiteralPath $Path
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') { throw 'Valid Microsoft Authenticode signature required.' }
    }
}
function Save-GuestArtifact($Tool, [string]$RunRoot) {
    $destination = Join-Path $RunRoot $Tool.filename
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = [Net.Http.HttpClient]::new(); $client.Timeout = [TimeSpan]::FromMinutes(20)
    $response = $null; $stream = $null; $output = $null
    try {
        $response = $client.GetAsync($Tool.url,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        [void]$response.EnsureSuccessStatusCode()
        if ($response.RequestMessage.RequestUri.Scheme -ne 'https' -or $response.Content.Headers.ContentLength -gt $Tool.maxBytes) { throw 'Unsafe/oversize download response.' }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $output = [IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $buffer = New-Object byte[] 65536; [long]$total = 0; $deadline = [DateTime]::UtcNow.AddMinutes(20)
        while ($true) {
            $read = $stream.ReadAsync($buffer,0,$buffer.Length)
            $remaining = [Math]::Max(1,[int]($deadline-[DateTime]::UtcNow).TotalMilliseconds)
            if (-not $read.Wait($remaining)) { throw 'Download body exceeded time bound.' }
            $count = $read.GetAwaiter().GetResult()
            if ($count -eq 0) { break }
            $total += $count
            if ($total -gt $Tool.maxBytes -or [DateTime]::UtcNow -gt $deadline) { throw 'Download exceeded bounded size/time.' }
            $output.Write($buffer,0,$count)
        }
    } finally { if ($output) {$output.Dispose()}; if ($stream) {$stream.Dispose()}; if ($response) {$response.Dispose()}; $client.Dispose() }
    Test-GuestArtifact $Tool $destination
    return $destination
}

function Get-GuestRustProxyPlan([string]$Bin, [string]$ExpectedSha256) {
    # Read-only, separately testable validation. Production always supplies the
    # fixed guest Cargo bin and the pinned official rustup-init digest.
    # https://github.com/rust-lang/rustup/blob/1.29.2/src/lib.rs (TOOLS/DUP_TOOLS)
    if ($ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$' -or -not (Test-GuestNoReparse $Bin) -or -not (Test-Path -LiteralPath $Bin -PathType Container)) { throw 'Rust proxy bin must be a regular bounded directory.' }
    $rustup = Join-Path $Bin 'rustup.exe'
    if (-not (Test-GuestNoReparse $rustup) -or -not (Test-Path -LiteralPath $rustup -PathType Leaf) -or (Get-GuestSha $rustup) -cne $ExpectedSha256) { throw 'Rustup proxy target differs from the pinned official bootstrap.' }
    $names = @('rustc.exe','rustdoc.exe','cargo.exe','rust-lldb.exe','rust-gdb.exe','rust-gdbgui.exe','rls.exe','cargo-clippy.exe','clippy-driver.exe','cargo-miri.exe','rust-analyzer.exe','rustfmt.exe','cargo-fmt.exe')
    $entries = @(Get-ChildItem -Force -LiteralPath $Bin)
    if ($entries.Count -gt 64) { throw 'Rust proxy bin exceeds entry bound.' }
    $links = @()
    foreach ($entry in $entries) {
        if ($entry.PSIsContainer) { throw 'Unexpected directory/junction in Rust proxy bin.' }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($entry.Name -cnotin $names -or $entry.LinkType -cne 'SymbolicLink') { throw 'Unknown Rust proxy reparse point.' }
            $targets = @($entry.Target)
            if ($targets.Count -ne 1 -or $targets[0] -cne 'rustup.exe') { throw 'Rust proxy must point only to relative rustup.exe in the same bin.' }
            if ((Get-GuestSha $entry.FullName) -cne $ExpectedSha256) { throw 'Rust symbolic proxy bytes differ from the pinned target.' }
            $links += [pscustomobject]@{name=$entry.Name;path=$entry.FullName;target='rustup.exe';sha256=$ExpectedSha256}
        } elseif ($entry.Name -cin $names) {
            if ($entry.Length -le 0 -or $entry.Length -gt 33554432 -or (Get-GuestSha $entry.FullName) -cne $ExpectedSha256) { throw 'Existing regular Rust proxy differs from pinned rustup.' }
        }
    }
    return [pscustomobject]@{bin=[IO.Path]::GetFullPath($Bin);rustup=$rustup;sha256=$ExpectedSha256;links=@($links);needsNormalization=($links.Count -gt 0)}
}

function Normalize-GuestRustProxies([string]$VmUuid, [string]$RunRoot) {
    # The only mutation entrypoint uses actual facts and fixed production roots.
    # There is no CLI fixture/root/hash override and no general symlink allowance.
    [void](Assert-ActualGuest $VmUuid)
    $bin = "$CargoHome\bin"
    if (-not (Test-Path -LiteralPath $bin)) { return }
    if (-not (Test-GuestNoReparse $RunRoot) -or -not (Test-Path -LiteralPath $RunRoot -PathType Container) -or -not [IO.Path]::GetFullPath($RunRoot).StartsWith("$StateRoot\runs\",[StringComparison]::OrdinalIgnoreCase)) { throw 'Rust normalization evidence must stay in the owned guest run.' }
    $tool = Get-GuestToolManifest | Where-Object id -eq 'rust'
    $plan = Get-GuestRustProxyPlan $bin $tool.sha256
    $converted = @()
    foreach ($link in $plan.links) {
        # Revalidate every link immediately before unlinking only that link.
        $current = Get-GuestRustProxyPlan $bin $tool.sha256
        if (@($current.links | Where-Object {$_.name -ceq $link.name}).Count -ne 1) { throw 'Rust proxy changed during normalization.' }
        [IO.File]::Delete($link.path)
        New-Item -ItemType HardLink -Path $link.path -Target $plan.rustup | Out-Null
        if (-not (Test-GuestNoReparse $link.path) -or (Get-GuestSha $link.path) -cne $tool.sha256) { throw 'Rust hardlink normalization verification failed.' }
        $converted += $link.name
    }
    $after = Get-GuestRustProxyPlan $bin $tool.sha256
    if ($after.needsNormalization) { throw 'Rust symbolic proxies remain after normalization.' }
    Write-GuestJson "$RunRoot\rust-proxy-normalization.json" ([ordered]@{schemaVersion=1;evidence='known-rustup-proxy-hardlinks';status='passed';vmUuid=$VmUuid;rustupSha256=$tool.sha256;converted=$converted;completedAt=[DateTime]::UtcNow.ToString('o')})
}

function Get-GuestToolState($Tool) {
    $version = $null; $location = $null
    $paths = @{node='C:\Program Files\nodejs\node.exe';powershell='C:\Program Files\PowerShell\7\pwsh.exe';git='C:\Program Files\Git\cmd\git.exe';python='C:\Program Files\Python314\python.exe';rust="$CargoHome\bin\rustc.exe";pnpm="$ToolsRoot\pnpm\12.15.0\pnpm.exe"}
    if ($paths.ContainsKey($Tool.id)) {
        $location = $paths[$Tool.id]
        if ($Tool.id -eq 'rust' -and (Test-Path -LiteralPath "$CargoHome\bin")) {
            $proxies = Get-GuestRustProxyPlan "$CargoHome\bin" $Tool.sha256
            if ($proxies.needsNormalization) {
                return [pscustomobject]@{id='rust';path=$location;present=(Test-Path -LiteralPath $location -PathType Leaf);version=$null;compatible=$false;needsNormalization=$true;diagnostic='Known Rustup 1.29.2 symbolic proxies require guarded Install normalization; no Rust executable was run.'}
            }
        }
        if (Test-Path -LiteralPath $location -PathType Leaf) {
            $arguments = @('--version')
            if ($Tool.id -eq 'powershell') { $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()') }
            if ($Tool.id -eq 'rust') { $arguments = @('+1.99.1','--version') }
            $result = Invoke-GuestProcess $location $arguments
            if ($result.exitCode -ne 0) { throw "Existing $($Tool.id) failed version verification." }
            $version = [regex]::Match($result.stdout,'\d+\.\d+\.\d+(?:\.\d+)?').Value
            if ($Tool.id -eq 'git') { $version = [regex]::Match($result.stdout.Replace('.windows.','.'),'\d+\.\d+\.\d+(?:\.\d+)?').Value }
            if ($Tool.id -eq 'git' -and -not (Test-Path -LiteralPath 'C:\Program Files\Git\bin\bash.exe' -PathType Leaf)) { throw 'Git Bash is missing.' }
        }
    } elseif ($Tool.id -eq 'webview2') {
        $location = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
        if (Test-Path -LiteralPath $location) { $version = (Get-ItemProperty -LiteralPath $location -Name pv).pv }
    } elseif ($Tool.id -eq 'msvc') {
        $location = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
        $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
            $result = Invoke-GuestProcess $vswhere @('-products','Microsoft.VisualStudio.Product.BuildTools','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','Microsoft.VisualStudio.Component.Windows11SDK.26100','-format','json','-version','[17.14,18.0)')
            if ($result.exitCode -ne 0) { throw 'vswhere failed.' }
            $instance = @($result.stdout | ConvertFrom-Json) | Where-Object { $_.installationPath -ieq $location -and $_.isComplete } | Select-Object -First 1
            if ($instance) { $version = $instance.installationVersion }
        }
        if ($version -and (@(Get-ChildItem -Path "$location\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe" -ErrorAction SilentlyContinue).Count -eq 0 -or @(Get-ChildItem -Path 'C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.*\um\Windows.h' -ErrorAction SilentlyContinue).Count -eq 0)) { throw 'Installed MSVC/Windows SDK payload is incomplete.' }
    }
    $present = [bool]$version
    $minimum = $Tool.version
    if ($Tool.id -eq 'msvc') { $minimum = $Tool.buildVersion }
    $compatible = $present -and ([version]$version -ge [version]$minimum)
    if ($Tool.id -eq 'node' -and $present) { $compatible = $compatible -and ([version]$version).Major -eq 24 }
    if ($Tool.id -eq 'powershell' -and $present) { $compatible = $compatible -and ([version]$version).Major -eq 7 }
    if ($Tool.id -eq 'pnpm' -and $present) { $compatible = $version -eq $Tool.version }
    return [pscustomobject]@{id=$Tool.id;path=$location;present=$present;version=$version;compatible=$compatible}
}

function Expand-GuestPnpm([string]$Archive) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destination = "$ToolsRoot\pnpm\12.15.0"
    if (Test-Path -LiteralPath $destination) { throw 'Existing incomplete pnpm destination must be reviewed.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 5000) { throw 'pnpm archive exceeds entry bound.' }
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            $total += $entry.Length
            if ($name.StartsWith('/') -or $name.Contains(':') -or '..' -in $name.Split('/') -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or $total -gt 536870912) { throw 'Unsafe pnpm archive entry.' }
        }
    } finally { $zip.Dispose() }
    New-Item -ItemType Directory -Path $destination | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive,$destination)
    if (-not (Test-Path -LiteralPath "$destination\pnpm.exe")) { throw 'Unexpected pnpm archive layout.' }
}

function Install-GuestTool($Tool, [string]$Artifact, [string]$RunRoot) {
    $file = $Artifact; $arguments = @(); $timeout = 900
    switch ($Tool.id) {
        'node' { $file="$env:WINDIR\System32\msiexec.exe"; $arguments=@('/i',$Artifact,'/qn','/norestart','INSTALLDIR=C:\Program Files\nodejs','/L*v',"$RunRoot\node-msi.log") }
        'powershell' { $file="$env:WINDIR\System32\msiexec.exe"; $arguments=@('/i',$Artifact,'/qn','/norestart','ADD_PATH=1','ENABLE_PSREMOTING=0','USE_MU=0','ENABLE_MU=0','/L*v',"$RunRoot\powershell-msi.log") }
        'git' { $arguments=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NOCANCEL','/DIR=C:\Program Files\Git',"/LOG=$RunRoot\git-install.log") }
        'msvc' { $timeout=7200; $arguments=@('--quiet','--wait','--norestart','--nocache','--installPath','C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools','--add','Microsoft.VisualStudio.Workload.VCTools','--add','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','--add','Microsoft.VisualStudio.Component.Windows11SDK.26100') }
        'rust' { $timeout=1800; New-Item -ItemType Directory -Path $CargoHome,$RustupHome -Force | Out-Null; $arguments=@('-y','--default-host','x86_64-pc-windows-msvc','--default-toolchain',$Tool.version,'--profile','minimal','--component','clippy','--component','rustfmt','--no-modify-path') }
        'webview2' { $arguments=@('/silent','/install') }
        'python' { $arguments=@('/quiet','InstallAllUsers=1','TargetDir=C:\Program Files\Python314','PrependPath=1','Include_test=0','Include_launcher=0', '/log',"$RunRoot\python-install.log") }
        'pnpm' { Expand-GuestPnpm $Artifact; return [pscustomobject]@{exitCode=0;stdout='Verified pinned archive extracted.';stderr=''} }
    }
    $result = Invoke-GuestProcess $file $arguments $timeout "$RunRoot\$($Tool.id)"
    if ($result.exitCode -notin @(0,3010)) { throw "$($Tool.id) installer failed with exit code $($result.exitCode); see $RunRoot." }
    return $result
}

function Get-GuestRustInventory {
    $files = [Collections.Generic.List[object]]::new(); [long]$total=0
    foreach ($name in @('cargo','rustup')) {
        $root = Join-Path $ToolsRoot $name
        if (-not (Test-GuestNoReparse $root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Verified Rust source tree missing.' }
        if ($name -eq 'cargo' -and ((Test-Path -LiteralPath "$root\credentials") -or (Test-Path -LiteralPath "$root\credentials.toml"))) { throw 'Credentials are forbidden in toolchain seeds.' }
        foreach ($entry in Get-ChildItem -Force -LiteralPath $root -Recurse) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Rust source tree contains a reparse point.' }
            if ($entry.PSIsContainer) { continue }
            $total += $entry.Length
            if ($files.Count -ge 50000 -or $entry.Length -gt 536870912 -or $total -gt 17179869184) { throw 'Rust seed exceeds inventory bound.' }
            $relative = $entry.FullName.Substring($root.Length+1).Replace('\','/')
            $files.Add([pscustomobject]@{path="$name/$relative";bytes=$entry.Length;sha256=Get-GuestSha $entry.FullName})
        }
    }
    return @($files | Sort-Object path)
}

function Get-GuestInventoryIndex([object[]]$Files) {
    if (-not $Files -or $Files.Count -gt 50000) { throw 'Rust seed inventory exceeds entry bound or is empty.' }
    $index = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    [long]$total = 0
    foreach ($entry in $Files) {
        if ($entry.path -isnot [string] -or $entry.path.Length -gt 1024 -or $entry.path -cnotmatch '^(cargo|rustup)/[^\\:\x00-\x1f]+$' -or @($entry.path.Split('/') | Where-Object {$_ -in @('','.','..')}).Count -or $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or ($entry.bytes -isnot [int] -and $entry.bytes -isnot [long]) -or $entry.bytes -lt 0 -or $entry.bytes -gt 536870912) { throw 'Malformed Rust seed inventory entry.' }
        if ($index.ContainsKey($entry.path)) { throw 'Duplicate exact Rust seed inventory path.' }
        $total += $entry.bytes
        if ($total -gt 17179869184) { throw 'Rust seed inventory exceeds byte bound.' }
        $index.Add($entry.path,$entry)
    }
    return ,$index
}
function Assert-GuestInventorySame([object[]]$Current, [object[]]$Recorded) {
    # PS5.1/PS7 and cultures can sort punctuation differently. File identity is
    # the exact path + integer byte count + SHA256, never serialized row order.
    $actual = Get-GuestInventoryIndex $Current
    $expected = Get-GuestInventoryIndex $Recorded
    if ($actual.Count -ne $expected.Count) { throw 'Rust seed inventory has missing or additional paths.' }
    foreach ($file in $expected.Keys) {
        if (-not $actual.ContainsKey($file) -or $actual[$file].bytes -ne $expected[$file].bytes -or $actual[$file].sha256 -cne $expected[$file].sha256) { throw 'Rust seed hashes, bytes or exact paths changed after verified installation.' }
    }
}

function Invoke-GuestInstall([string]$VmUuid) {
    $facts = Assert-ActualGuest $VmUuid
    $manifest = @(Get-GuestToolManifest); Assert-GuestManifest $manifest
    $run = Initialize-GuestState $facts
    $receipt = [ordered]@{schemaVersion=1;evidence='dedicated-guest-tools';vmUuid=$facts.vmUuid;accountSid=$facts.sid;startedAt=[DateTime]::UtcNow.ToString('o');completedAt=$null;status='running';rebootRequired=$false;tools=@();error=$null}
    try {
        foreach ($tool in $manifest) {
            if (($tool.id -eq 'python' -and -not $IncludePython) -or ($tool.id -eq 'pnpm' -and -not $IncludePnpm)) { continue }
            if ($tool.id -eq 'rust') { Normalize-GuestRustProxies $VmUuid $run }
            $before = Get-GuestToolState $tool
            if ($before.present -and -not $before.compatible) { throw "Existing $($tool.id) version $($before.version) is incompatible; refusing implicit replacement." }
            $action='reused'; $exitCode=0
            if (-not $before.present) {
                $artifact = Save-GuestArtifact $tool $run
                $result = Install-GuestTool $tool $artifact $run
                $exitCode=$result.exitCode; $action='installed'
                if ($exitCode -eq 3010) { $receipt.rebootRequired=$true }
                if ($tool.id -eq 'rust') { Normalize-GuestRustProxies $VmUuid $run }
            }
            $after = Get-GuestToolState $tool
            $receipt.tools += [pscustomobject]@{id=$tool.id;action=$action;expectedVersion=$tool.version;sha256=$tool.sha256;downloadUrl=$tool.url;exitCode=$exitCode;observed=$after}
            if (-not $after.compatible) { throw "$($tool.id) post-install version/payload verification failed." }
            Write-GuestJson "$run\receipt.json" $receipt
        }
        $inventory = @(Get-GuestRustInventory)
        Write-GuestJson "$StateRoot\rust-seed.json" ([ordered]@{schemaVersion=1;vmUuid=$facts.vmUuid;accountSid=$facts.sid;rustVersion='1.99.1';rustupVersion='1.29.2';files=$inventory})
        $receipt.status='passed'
    } catch { $receipt.status='failed'; $receipt.error=$_.Exception.Message; throw }
    finally { $receipt.completedAt=[DateTime]::UtcNow.ToString('o'); Write-GuestJson "$run\receipt.json" $receipt; Write-GuestJson "$StateRoot\latest.json" $receipt }
    return $receipt
}

function Invoke-GuestSeed([string]$VmUuid) {
    $facts = Assert-ActualGuest $VmUuid
    foreach ($file in @("$StateRoot\latest.json","$StateRoot\rust-seed.json",'C:\bycoda-actions\control\policy.json')) { if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or -not (Test-GuestNoReparse $file)) { throw 'Successful tools install and runner Prepare must precede seeding.' } }
    foreach ($item in @($BootstrapRoot,$StateRoot,$ToolsRoot,'C:\bycoda-actions\control','C:\bycoda-actions\control\policy.json')) { Assert-GuestProtected $item }
    $policy = Get-Content -Raw -LiteralPath 'C:\bycoda-actions\control\policy.json' | ConvertFrom-Json
    if ($policy.schemaVersion -ne 1 -or $policy.machineUuid -ine $facts.vmUuid -or $policy.repository -cne 'bahadryalcn/bycoda' -or [string]$policy.repositoryId -ne '1413796716' -or $policy.runnerSid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { throw 'Runner policy belongs to another VM/repository/account.' }
    $receipt = Get-Content -Raw -LiteralPath "$StateRoot\latest.json" | ConvertFrom-Json
    $seed = Get-Content -Raw -LiteralPath "$StateRoot\rust-seed.json" | ConvertFrom-Json
    if ($receipt.status -ne 'passed' -or $receipt.vmUuid -ine $facts.vmUuid -or $seed.vmUuid -ine $facts.vmUuid -or $seed.accountSid -ne $facts.sid -or $seed.schemaVersion -ne 1) { throw 'Rust seed belongs to another or incomplete guest installation.' }
    foreach ($name in @('cargo','rustup')) {
        $destination = if ($name -eq 'cargo') {'C:\bycoda-actions\cache\cargo-home'} else {'C:\bycoda-actions\cache\rustup-home'}
        if (-not (Test-GuestNoReparse $destination) -or -not (Test-Path -LiteralPath $destination -PathType Container) -or @(Get-ChildItem -Force -LiteralPath $destination).Count) { throw 'Runner cache must be a prepared, empty regular directory.' }
        Assert-GuestProtected $destination $policy.runnerSid
    }
    $current = @(Get-GuestRustInventory)
    Assert-GuestInventorySame $current @($seed.files)
    foreach ($entry in $current) {
        $parts = $entry.path.Split('/',2)
        $destination = if ($parts[0] -eq 'cargo') {'C:\bycoda-actions\cache\cargo-home'} else {'C:\bycoda-actions\cache\rustup-home'}
        $target = Join-Path $destination $parts[1].Replace('/','\')
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        [IO.File]::Copy((Join-Path $ToolsRoot $entry.path.Replace('/','\')),$target,$false)
        if ((Get-GuestSha $target) -cne $entry.sha256) { throw 'Copied Rust seed hash mismatch; review partial cache before retry.' }
    }
    $result = [ordered]@{schemaVersion=1;evidence='dedicated-guest-rust-cache-seed';vmUuid=$facts.vmUuid;status='passed';fileCount=$current.Count;copiedAt=[DateTime]::UtcNow.ToString('o');aclCopied=$false}
    Write-GuestJson "$StateRoot\runner-cache-seed.json" $result
    return $result
}

# Dot-sourcing exposes pure contract helpers to offline tests; never executes a mode.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($Mode -eq 'Plan') {
            $facts=Get-GuestFacts; $denials=@(Get-GuestDenials $facts $ExpectedVmUuid)
            $manifest=@(Get-GuestToolManifest); Assert-GuestManifest $manifest
            $states=@()
            if ($denials.Count -eq 0) { foreach ($tool in $manifest) { try { $states += Get-GuestToolState $tool } catch { $states += [pscustomobject]@{id=$tool.id;compatible=$false;untrustedPath=$true;error=$_.Exception.Message} } } }
            [ordered]@{schemaVersion=1;mode='Plan';readOnly=$true;allowedInstall=($denials.Count -eq 0);denials=$denials;facts=$facts;bootstrapRoot=$BootstrapRoot;stateRoot=$StateRoot;rustHomes=@($CargoHome,$RustupHome);toolManifest=$manifest;toolStates=$states;pythonOptIn=[bool]$IncludePython;pnpmOptIn=[bool]$IncludePnpm;runnerRegistration=$false;automaticRestart=$false} | ConvertTo-Json -Depth 15
        } elseif ($Mode -eq 'Install') { Invoke-GuestInstall $ExpectedVmUuid | ConvertTo-Json -Depth 20 }
        else { Invoke-GuestSeed $ExpectedVmUuid | ConvertTo-Json -Depth 20 }
    } catch { Write-Error $_; exit 1 }
}
