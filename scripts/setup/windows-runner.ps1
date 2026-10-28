#Requires -Version 7.0
<#
Dedicated guest only. Plan/Status/Verify never provision or register anything.
Prepare and Register require an elevated guest administrator; Run requires the
real, nonadministrator bycoda-runner account in an interactive desktop session.
No service, personal-account override, automatic download, or automatic update.
#>
[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Status', 'Prepare', 'Register', 'Run', 'Verify')][string]$Mode = 'Plan',
    [ValidateSet('ci', 'package')][string]$Purpose = 'ci',
    [string]$ArchivePath,
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [string]$PowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe',
    [switch]$TokenFromStdin,
    [switch]$ExportEnvironment
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = 'C:\bycoda-actions'
$Control = "$Root\control"
$Agent = "$Root\agent"
$Work = "$Root\work"
$Cache = "$Root\cache"
$ProfileRoot = "$Root\profile"
$Account = 'bycoda-runner'
$Version = '2.338.2'
$ArchiveBytes = 104210683
$ArchiveSha = 'a1f17aa987fc8158bc7521d284912267a0d01b7c2c4684b33c86783b5e8221cc'
$PolicyPath = "$Control\policy.json"
$FirewallName = 'bycoda-isolated-runner-block-private-egress'
$PrivateRanges = @('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', 'fc00::/7', 'fe80::/10')
$AdminSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$TrustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$WindowsRoot = [Environment]::GetFolderPath('Windows')

function Test-NoReparse([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or $Path.StartsWith('\\') -or $Path.Substring(2).Contains(':')) { return $false }
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $true
}

function Get-EffectiveFileRights($Rule) {
    # InheritOnly grants rights to descendants, not this directory. Every actual
    # child is checked separately, including its inherited effective ACEs.
    if ($Rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { return [long]0 }
    [long]$raw = $Rule.FileSystemRights
    if ($raw -lt 0) { $raw += 4294967296 }
    [long]$mapped = $raw -band 0x0fffffff
    # FILE_GENERIC_READ/WRITE/EXECUTE and FILE_ALL_ACCESS (winnt.h).
    if ($raw -band 0x80000000L) { $mapped = $mapped -bor 0x120089 }
    if ($raw -band 0x40000000L) { $mapped = $mapped -bor 0x120116 }
    if ($raw -band 0x20000000L) { $mapped = $mapped -bor 0x1200a0 }
    if ($raw -band 0x10000000L) { $mapped = $mapped -bor 0x1f01ff }
    return $mapped
}

function Test-Protected([string]$Path, [switch]$Ancestors) {
    if (-not (Test-Path -LiteralPath $Path) -or -not (Test-NoReparse $Path)) { return $false }
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        $acl = Get-Acl -LiteralPath $cursor
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin @($AdminSid, $SystemSid, $TrustedInstallerSid)) { return $false }
        # Modify includes ReadAndExecute bits; never use that composite in a
        # writable-bit mask or harmless reader ACEs would also be rejected.
        $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
        # Creating an unrelated sibling on C:\ is harmless; replacing this child's
        # ancestor is not. Do not require changing the system drive's normal ACL.
        if ($cursor -ne [IO.Path]::GetFullPath($Path)) { $write = [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership }
        foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($ace.AccessControlType -eq 'Allow' -and ((Get-EffectiveFileRights $ace) -band $write) -and $ace.IdentityReference.Value -notin @($AdminSid, $SystemSid, $TrustedInstallerSid)) { return $false }
        }
        if (-not $Ancestors) { break }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $true
}

function Set-OwnedAcl([string]$Path, [string]$RunnerSid, [switch]$Writable) {
    $item = Get-Item -Force -LiteralPath $Path
    $acl = if ($item.PSIsContainer) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($AdminSid))
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($principal in @($AdminSid, $SystemSid)) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($principal), [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    $rights = if ($Writable) { [Security.AccessControl.FileSystemRights]::Modify } else { [Security.AccessControl.FileSystemRights]::ReadAndExecute }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($RunnerSid), $rights, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Test-OwnedWritableRoot([string]$Path, [string]$RunnerSid) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container) -or -not (Test-NoReparse $Path)) { return $false }
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($AdminSid, $SystemSid)) { return $false }
    $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        $effective = Get-EffectiveFileRights $ace
        if ($ace.AccessControlType -eq 'Allow' -and ($effective -band $write) -and $ace.IdentityReference.Value -notin @($AdminSid, $SystemSid, $RunnerSid)) { return $false }
        if ($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -eq $RunnerSid -and ($effective -band ([Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership))) { return $false }
    }
    return $true
}

function Get-Sha([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Test-PrivateEgressRanges([string[]]$Addresses) {
    # NetSecurity renders these five IPv4 CIDRs as dotted masks. Accept only
    # their exact equivalents and the seven canonical policy spellings; never
    # interpret Any, aliases, arbitrary masks, broader or narrower prefixes.
    if (-not $Addresses -or $Addresses.Count -gt 64) { return $false }
    $aliases = @{}
    foreach ($required in $PrivateRanges) { $aliases[$required] = $required }
    $aliases['10.0.0.0/255.0.0.0'] = '10.0.0.0/8'
    $aliases['172.16.0.0/255.240.0.0'] = '172.16.0.0/12'
    $aliases['192.168.0.0/255.255.0.0'] = '192.168.0.0/16'
    $aliases['169.254.0.0/255.255.0.0'] = '169.254.0.0/16'
    $aliases['100.64.0.0/255.192.0.0'] = '100.64.0.0/10'
    $seen = @{}
    foreach ($address in $Addresses) {
        if ([string]::IsNullOrEmpty($address) -or -not $aliases.ContainsKey($address)) { return $false }
        $seen[$aliases[$address]] = $true
    }
    return $seen.Count -eq $PrivateRanges.Count
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    if ((Get-Item -Force -LiteralPath $Path).Length -gt 4194304) { throw 'Configuration exceeds size bound.' }
    # Hidden GitHub configuration needs Force for metadata only. Get-Content
    # -Force also requests WriteAttributes, which the runner intentionally lacks.
    return [IO.File]::ReadAllText($Path) | ConvertFrom-Json -AsHashtable
}
function Write-JsonFile([string]$Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false)) }

function Invoke-CleanTool([string]$Executable, [string[]]$Arguments, [string]$InputText = '') {
    # NODE_OPTIONS, CLR profiler/startup hooks and arbitrary inherited variables
    # must not run before a verification decision, including --version calls.
    $start = [Diagnostics.ProcessStartInfo]::new($Executable)
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.Environment.Clear()
    $start.Environment['SystemRoot'] = $WindowsRoot
    $start.Environment['WINDIR'] = $WindowsRoot
    $start.Environment['TEMP'] = [Environment]::GetFolderPath('LocalApplicationData') + '\Temp'
    $start.Environment['TMP'] = $start.Environment['TEMP']
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $child = [Diagnostics.Process]::Start($start)
    $output = $child.StandardOutput.ReadToEndAsync(); $errorOutput = $child.StandardError.ReadToEndAsync()
    $child.StandardInput.Write($InputText); $child.StandardInput.Close()
    $child.WaitForExit()
    $result = @{ exitCode = $child.ExitCode; output = $output.GetAwaiter().GetResult() }
    $null = $errorOutput.GetAwaiter().GetResult()
    return $result
}

function Get-RunnerFacts {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $computer = Get-CimInstance Win32_ComputerSystem
    $uuid = (Get-CimInstance Win32_ComputerSystemProduct).UUID
    $target = Get-LocalUser -Name $Account -ErrorAction SilentlyContinue
    $targetSid = if ($target) { $target.SID.Value } else { '' }
    $adminMembers = @(Get-LocalGroupMember -SID $AdminSid -ErrorAction Stop | ForEach-Object { $_.SID.Value })
    $profileKey = if ($targetSid) { Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$targetSid" -ErrorAction SilentlyContinue } else { $null }
    $profilePath = if ($profileKey) { $profileKey.ProfileImagePath } else { '' }
    $currentProfile = [Environment]::GetFolderPath('UserProfile')
    $shares = @(Get-SmbMapping -ErrorAction Stop)
    $drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 4')
    $sharedServices = @(Get-Service -Name 'vmicguestinterface', 'VMTools', 'VBoxService' -ErrorAction SilentlyContinue | Where-Object Status -eq Running)
    $personalServices = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -match '(?i)bycoda|monocode' -or $_.PathName -match '(?i)bycoda|monocode' })
    $personalProcesses = @(Get-Process -Name bycoda, bycoda-host, monocode -ErrorAction SilentlyContinue)
    $writablePaths = @($Work, $Cache, $ProfileRoot, "$Cache\cargo-home", "$Cache\rustup-home", "$Cache\cargo-target", "$Cache\cargo-target\ci", "$Cache\cargo-target\release", "$Cache\pnpm-store", "$Cache\pnpm-home", "$Cache\npm", "$Cache\xdg", "$Work\_temp", "$Agent\_diag")
    $fixedPaths = @($Root, $Control, $Agent) + $writablePaths
    $ownedRoots = -not (Test-Path -LiteralPath $Root)
    if (-not $ownedRoots -and $targetSid) { $ownedRoots = @($writablePaths | Where-Object { -not (Test-OwnedWritableRoot $_ $targetSid) }).Count -eq 0 }
    $reparseFree = @($fixedPaths | Where-Object { -not (Test-NoReparse $_) }).Count -eq 0
    if ((Test-Path -LiteralPath $Root) -and $reparseFree) {
        # pnpm legitimately creates links inside job checkouts. Only immutable
        # control/agent trees and operational directory roots must be link-free.
        $reparseFree = @(Get-ChildItem -LiteralPath $Control, $Agent -Force -Recurse -Attributes ReparsePoint -ErrorAction Stop).Count -eq 0
    }
    $policy = Read-JsonFile $PolicyPath
    $trusted = $false; $hashes = $false; $shim = $false
    if ($policy -and (Test-Protected $Root -Ancestors) -and (Test-Protected $Control -Ancestors) -and (Test-Protected $PolicyPath -Ancestors)) {
        $trusted = $true; $hashes = $true
        foreach ($required in @('control\node.exe', 'control\windows-runner.ps1', 'control\windows-runner-model.mjs', 'control\windows-runner-trust.mjs', 'control\shell\pwsh.exe', 'control\pre-job.ps1', 'agent\bin\Runner.Listener.exe')) {
            if (-not $policy.files.ContainsKey($required)) { $hashes = $false }
        }
        foreach ($entry in $policy.files.GetEnumerator()) {
            $full = [IO.Path]::GetFullPath((Join-Path $Root $entry.Key))
            if (-not $full.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Protected $full -Ancestors) -or (Get-Sha $full) -ne $entry.Value) { $hashes = $false }
        }
        $shim = $hashes -and $policy.profilesDisabledByShim -eq $true
    }
    $archiveVerified = $false
    if ($ArchivePath -and (Test-Path -LiteralPath $ArchivePath -PathType Leaf) -and (Test-NoReparse $ArchivePath)) {
        $archiveVerified = (Get-Item -LiteralPath $ArchivePath).Length -eq $ArchiveBytes -and (Get-Sha $ArchivePath) -eq $ArchiveSha
    }
    $compiler = "$WindowsRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    $nodeValid = (Test-Protected $NodePath -Ancestors) -and (Get-AuthenticodeSignature -LiteralPath $NodePath).Status -eq 'Valid'
    if ($nodeValid) { $nodeValid = (Invoke-CleanTool $NodePath @('--version')).output.Trim() -match '^v24\.' }
    $pwshValid = (Test-Protected $PowerShellPath -Ancestors) -and (Get-AuthenticodeSignature -LiteralPath $PowerShellPath).Status -eq 'Valid'
    if ($policy -and $hashes) {
        $hashes = (Test-Protected $policy.powerShellPath -Ancestors) -and (Get-Sha $policy.powerShellPath) -eq $policy.powerShellSha256
    }
    $redirection = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' -ErrorAction SilentlyContinue
    $rule = Get-NetFirewallRule -Name $FirewallName -ErrorAction SilentlyContinue
    $privateBlocked = $false
    if ($rule -and $rule.Enabled -eq 'True' -and $rule.Direction -eq 'Outbound' -and $rule.Action -eq 'Block' -and $rule.Profile -eq 'Any') {
        $remote = @($rule | Get-NetFirewallAddressFilter | ForEach-Object RemoteAddress)
        $privateBlocked = (Test-PrivateEgressRanges $remote) -and @(Get-NetFirewallProfile | Where-Object Enabled -ne True).Count -eq 0 -and (Get-Service MpsSvc).Status -eq 'Running'
    }
    $runner = Read-JsonFile "$Agent\.runner"
    $registered = $null -ne $runner
    $configProtected = $registered
    foreach ($required in @('.runner', '.credentials', '.credentials_rsaparams')) { $configProtected = $configProtected -and (Test-Path -LiteralPath "$Agent\$required" -PathType Leaf) }
    # A separately migrated config must not silently take precedence over the
    # registered repository/pin inspected here. Review migrations while stopped.
    foreach ($unexpected in @('.runner_migrated', '.credentials_migrated')) { if (Test-Path -LiteralPath "$Agent\$unexpected") { $configProtected = $false } }
    foreach ($name in @('.runner', '.credentials', '.credentials_rsaparams', '.env', '.path')) {
        if (Test-Path -LiteralPath "$Agent\$name") { $configProtected = $configProtected -and (Test-Protected "$Agent\$name" -Ancestors) }
    }
    $matching = $registered -and $runner.agentName -eq 'bycoda-windows-isolated-01' -and $runner.gitHubUrl.TrimEnd('/') -eq 'https://github.com/bahadryalcn/bycoda' -and $runner.workFolder -eq $Work -and $runner.disableUpdate -eq $true
    $listenerVersion = if ($hashes -and (Test-Path -LiteralPath "$Agent\bin\Runner.Listener.exe")) { (Invoke-CleanTool "$Agent\bin\Runner.Listener.exe" @('--version')).output.Trim() } else { '' }
    return @{
        platform = 'win32'; architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        machine = @{ hypervisor = $computer.HypervisorPresent; uuid = $uuid; manufacturer = $computer.Manufacturer; model = $computer.Model; noHostShares = $shares.Count -eq 0 -and $drives.Count -eq 0 -and $sharedServices.Count -eq 0; noInstalledPersonalHost = $personalServices.Count -eq 0 -and $personalProcesses.Count -eq 0 -and -not (Test-Path -LiteralPath "$env:LOCALAPPDATA\bycoda") }
        target = @{ name = if ($target) { $target.Name } else { '' }; sid = $targetSid; nonAdmin = $targetSid -and $targetSid -notin $adminMembers; enabled = $target -and $target.Enabled; profile = $profilePath }
        current = @{ sid = $identity.User.Value; administrator = $admin; profile = $currentProfile; interactive = [Environment]::UserInteractive; sessionId = (Get-Process -Id $PID).SessionId }
        paths = @{ fixedRoots = $ownedRoots; reparseFree = $reparseFree; rootAbsent = -not (Test-Path -LiteralPath $Root) }
        archive = @{ verified = $archiveVerified }
        tools = @{ node24ProtectedSigned = $nodeValid; pwsh7Protected = $pwshValid; frameworkCompiler = (Test-Protected $compiler -Ancestors) }
        sources = @{ complete = (Test-Path -LiteralPath "$PSScriptRoot\windows-runner-model.mjs") -and (Test-Path -LiteralPath "$PSScriptRoot\..\checks\windows-runner-trust.mjs") }
        policy = $policy
        prepared = @{ trusted = $trusted; hashes = $hashes -and $listenerVersion -eq $Version; profilesDisabledByShim = $shim }
        network = @{ privateEgressBlocked = $privateBlocked; redirectionDisabled = $redirection -and $redirection.fDisableCdm -eq 1 -and $redirection.fDisableClip -eq 1 }
        runner = @{ registered = $registered; matches = $matching; protectedConfig = $configProtected; serviceInstalled = @(Get-Service -Name 'actions.runner.*' -ErrorAction SilentlyContinue).Count -gt 0; listenerActive = @(Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue).Count -gt 0 }
    }
}

function Invoke-Model($Facts, [string]$DecisionMode = $Mode) {
    $useControl = $DecisionMode -notin @('Plan', 'Status', 'Prepare')
    $runtime = if ($useControl) { "$Control\node.exe" } else { $NodePath }
    $model = if ($useControl) { "$Control\windows-runner-model.mjs" } else { "$PSScriptRoot\windows-runner-model.mjs" }
    if ($DecisionMode -in @('Plan', 'Status') -and -not (Test-Path -LiteralPath $runtime)) { $runtime = (Get-Command node -ErrorAction Stop).Source }
    if (-not (Test-Path -LiteralPath $runtime)) { throw 'Protected Node24 runtime prerequisite missing; no setup performed.' }
    if ($DecisionMode -notin @('Plan', 'Status') -and (-not (Test-Protected $runtime -Ancestors) -or ($useControl -and -not (Test-Protected $model -Ancestors)))) { throw 'Protected control runtime/model required.' }
    $json = $Facts | ConvertTo-Json -Depth 20 -Compress
    $result = Invoke-CleanTool $runtime @($model, $DecisionMode, $Purpose) $json
    if ($result.exitCode -notin @(0, 2)) { throw 'Runner decision helper failed.' }
    return $result.output | ConvertFrom-Json -AsHashtable
}

function Assert-SafeArchive([string]$ZipPath) {
    Add-Type -AssemblyName System.IO.Compression
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        if ($zip.Entries.Count -eq 0 -or $zip.Entries.Count -gt 20000) { throw 'Runner archive entry count rejected.' }
        [long]$bytes = 0
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            $bytes += $entry.Length
            if ($bytes -gt 1073741824 -or $name -match '(^/|[\x00-\x1f:])' -or ($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Runner archive unsafe path/link/size rejected.' }
            foreach ($part in $name.Split('/', [StringSplitOptions]::RemoveEmptyEntries)) {
                if ($part -in @('.', '..') -or $part -match '[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw 'Runner archive path component rejected.' }
            }
        }
    } finally { $zip.Dispose() }
}

function New-ProfileFreeShim([string]$Executable) {
    # Runner's default pwsh hook does not supply -NoProfile. Never load user profiles.
    $literal = $Executable.Replace('"', '""')
    $source = @'
using System;
using System.Diagnostics;
using System.Text;
class ProfileFreePowerShell {
  static string Quote(string arg) {
    var b = new StringBuilder("\""); int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') b.Append('\\', slashes * 2 + 1); else b.Append('\\', slashes);
      b.Append(c); slashes = 0;
    }
    b.Append('\\', slashes * 2); return b.Append('"').ToString();
  }
  static int Main(string[] args) {
    var start = new ProcessStartInfo(@"__POWERSHELL__");
    var list = new StringBuilder("-NoLogo -NoProfile -NonInteractive ");
    foreach (string arg in args) list.Append(Quote(arg)).Append(' ');
    start.Arguments = list.ToString(); start.UseShellExecute = false; start.CreateNoWindow = true;
    using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
  }
}
'@
    [IO.File]::WriteAllText("$Control\shell\ProfileFreePowerShell.cs", $source.Replace('__POWERSHELL__', $literal))
    $compile = Invoke-CleanTool "$WindowsRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe" @('/nologo', '/target:exe', "/out:$Control\shell\pwsh.exe", "$Control\shell\ProfileFreePowerShell.cs")
    if ($compile.exitCode -ne 0) { throw 'Profile-free shell compiler failed.' }
}

function Prepare-Runner($Facts) {
    if (-not $Facts.paths.rootAbsent) { return } # Verified immutable existing root is idempotent, never overwritten.
    Assert-SafeArchive $ArchivePath
    $runnerSid = $Facts.target.sid
    New-Item -ItemType Directory -Path $Root | Out-Null
    Set-OwnedAcl $Root $runnerSid
    foreach ($dir in @($Control, "$Control\shell", $Agent, $Work, $Cache, $ProfileRoot)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
        Set-OwnedAcl $dir $runnerSid -Writable:($dir -in @($Work, $Cache, $ProfileRoot))
    }
    [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $Agent, $false)
    Copy-Item -LiteralPath $NodePath -Destination "$Control\node.exe"
    Copy-Item -LiteralPath $PSCommandPath -Destination "$Control\windows-runner.ps1"
    Copy-Item -LiteralPath "$PSScriptRoot\windows-runner-model.mjs" -Destination "$Control\windows-runner-model.mjs"
    Copy-Item -LiteralPath "$PSScriptRoot\..\checks\windows-runner-trust.mjs" -Destination "$Control\windows-runner-trust.mjs"
    New-ProfileFreeShim $PowerShellPath
    $hook = @'
$ErrorActionPreference = 'Stop'
# This script is reached through the protected -NoProfile shell, never checkout code.
Remove-Item Env:NODE_OPTIONS, Env:NODE_PATH -ErrorAction SilentlyContinue
& 'C:\bycoda-actions\control\node.exe' 'C:\bycoda-actions\control\windows-runner-trust.mjs' --pre-job
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# A separate executable supplies an unambiguous exit status; an inline .ps1
# invocation can leave LASTEXITCODE unset and accidentally skip admission.
& 'C:\bycoda-actions\control\shell\pwsh.exe' -File 'C:\bycoda-actions\control\windows-runner.ps1' -Mode Verify -Purpose ci
exit $LASTEXITCODE
'@
    [IO.File]::WriteAllText("$Control\pre-job.ps1", $hook)
    # The real profile stays C:\Users\bycoda-runner. This separate root is operational data only.
    foreach ($dir in @("$Work\_temp", "$Cache\cargo-home", "$Cache\rustup-home", "$Cache\cargo-target", "$Cache\cargo-target\ci", "$Cache\cargo-target\release", "$Cache\pnpm-store", "$Cache\pnpm-home", "$Cache\npm", "$Cache\xdg", "$Agent\_diag")) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Set-OwnedAcl $dir $runnerSid -Writable
    }
    foreach ($item in Get-ChildItem -LiteralPath $Control, $Agent -Force -Recurse) {
        if ($item.FullName -ne "$Agent\_diag" -and -not $item.FullName.StartsWith("$Agent\_diag\")) { Set-OwnedAcl $item.FullName $runnerSid }
    }
    New-NetFirewallRule -Name $FirewallName -DisplayName 'bycoda isolated runner: block private network egress' -Enabled True -Profile Any -Direction Outbound -Action Block -RemoteAddress $PrivateRanges | Out-Null
    Set-NetFirewallProfile -Profile Domain, Private, Public -Enabled True
    $rdp = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
    New-Item -Path $rdp -Force | Out-Null
    New-ItemProperty -Path $rdp -Name fDisableCdm -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $rdp -Name fDisableClip -Value 1 -PropertyType DWord -Force | Out-Null
    $files = @{}
    foreach ($item in Get-ChildItem -LiteralPath $Control, $Agent -Force -Recurse -File) { $files[$item.FullName.Substring($Root.Length + 1)] = Get-Sha $item.FullName }
    $policy = @{
        schemaVersion = 1; repository = 'bahadryalcn/bycoda'; repositoryId = 1413796716; lifecycle = 'persistent-single-isolated-vm'
        runnerVersion = $Version; runnerSid = $runnerSid; machineUuid = $Facts.machine.uuid; labels = @('self-hosted', 'Windows', 'X64', 'bycoda-windows-isolated')
        archiveSha256 = $ArchiveSha; files = $files; profilesDisabledByShim = $true; powerShellPath = $PowerShellPath; powerShellSha256 = (Get-Sha $PowerShellPath); nodeVersion = (Invoke-CleanTool $NodePath @('--version')).output.Trim()
    }
    Write-JsonFile $PolicyPath $policy
    Set-OwnedAcl $PolicyPath $runnerSid
}

function New-SanitizedProcess([string[]]$Arguments, $Facts) {
    $info = [Diagnostics.ProcessStartInfo]::new("$Agent\bin\Runner.Listener.exe")
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = $Agent
    $info.Environment.Clear()
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')
    $base = @{
        SystemRoot = $WindowsRoot; WINDIR = $WindowsRoot; SystemDrive = [IO.Path]::GetPathRoot($WindowsRoot).TrimEnd('\')
        COMSPEC = "$WindowsRoot\System32\cmd.exe"; PATHEXT = '.COM;.EXE;.BAT;.CMD'; OS = 'Windows_NT'; PROCESSOR_ARCHITECTURE = 'AMD64'
        NUMBER_OF_PROCESSORS = [Environment]::ProcessorCount.ToString(); USERNAME = $identity[-1]; USERDOMAIN = $identity[0]
        USERPROFILE = $Facts.current.profile; APPDATA = "$($Facts.current.profile)\AppData\Roaming"; LOCALAPPDATA = "$($Facts.current.profile)\AppData\Local"
        HOMEDRIVE = [IO.Path]::GetPathRoot($Facts.current.profile).TrimEnd('\'); HOMEPATH = $Facts.current.profile.Substring(2)
        ProgramFiles = [Environment]::GetFolderPath('ProgramFiles'); 'ProgramFiles(x86)' = [Environment]::GetFolderPath('ProgramFilesX86')
        ProgramData = [Environment]::GetFolderPath('CommonApplicationData'); ALLUSERSPROFILE = [Environment]::GetFolderPath('CommonApplicationData'); PUBLIC = 'C:\Users\Public'
    }
    foreach ($pair in $base.GetEnumerator()) { $info.Environment[$pair.Key] = $pair.Value }
    $info.Environment['PATH'] = "$Control\shell;$Control;$WindowsRoot\System32;$WindowsRoot;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\Python314;C:\Program Files\nodejs;$Cache\pnpm-home;$Cache\cargo-home\bin"
    $info.Environment['PSModulePath'] = "C:\Program Files\PowerShell\7\Modules;$WindowsRoot\System32\WindowsPowerShell\v1.0\Modules"
    $info.Environment['ACTIONS_RUNNER_HOOK_JOB_STARTED'] = "$Control\pre-job.ps1"
    $info.Environment['ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT'] = '0'
    foreach ($pair in (Invoke-Model $Facts).environment.GetEnumerator()) { $info.Environment[$pair.Key] = $pair.Value }
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    return $info
}

function Register-Runner($Facts) {
    if ($Facts.runner.registered) { return }
    # This is a short-lived registration token, never a PAT, argv, source file or output.
    $secret = if ($TokenFromStdin) { [Console]::In.ReadLine() } else { [Net.NetworkCredential]::new('', (Read-Host 'One-time GitHub registration token' -AsSecureString)).Password }
    if (-not $secret -or $secret.Length -gt 4096 -or $secret -match '\s') { throw 'Missing/invalid one-time registration token.' }
    $info = New-SanitizedProcess @('configure', '--unattended', '--url', 'https://github.com/bahadryalcn/bycoda', '--name', 'bycoda-windows-isolated-01', '--work', $Work, '--labels', 'self-hosted,Windows,X64,bycoda-windows-isolated', '--no-default-labels', '--disableupdate') $Facts
    $info.Environment['ACTIONS_RUNNER_INPUT_TOKEN'] = $secret
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($info)
    $info.Environment.Remove('ACTIONS_RUNNER_INPUT_TOKEN') | Out-Null; $secret = $null
    $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
    $child.WaitForExit(); $null = $stdout.GetAwaiter().GetResult(); $null = $stderr.GetAwaiter().GetResult()
    foreach ($name in @('.runner', '.credentials', '.credentials_rsaparams', '.env', '.path')) {
        if (Test-Path -LiteralPath "$Agent\$name") { Set-OwnedAcl "$Agent\$name" $Facts.target.sid }
    }
    if ($child.ExitCode -ne 0) { throw 'GitHub registration failed. No raw credential-bearing output is emitted; inspect protected runner diagnostics as VM administrator.' }
}

try {
    if (-not $IsWindows) { throw 'Windows x64 guest required.' }
    if ($ExportEnvironment -and $Mode -ne 'Verify') { throw 'ExportEnvironment is accepted only by Verify.' }
    if ($TokenFromStdin -and $Mode -ne 'Register') { throw 'TokenFromStdin is accepted only by Register.' }
    if ($Mode -notin @('Plan', 'Status', 'Prepare') -and ($ArchivePath -or $PSBoundParameters.ContainsKey('NodePath') -or $PSBoundParameters.ContainsKey('PowerShellPath'))) { throw 'Runtime/archive overrides are forbidden after preparation.' }
    if ($Mode -eq 'Verify' -and $env:GITHUB_ACTIONS -eq 'true') {
        if (-not $env:GITHUB_WORKSPACE -or -not [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE).StartsWith("$Work\", [StringComparison]::OrdinalIgnoreCase) -or -not (Test-NoReparse $env:GITHUB_WORKSPACE)) { throw 'GitHub workspace must be a local regular checkout inside the fixed isolated work root.' }
    }
    $facts = Get-RunnerFacts
    $report = Invoke-Model $facts
    if (-not $report.allowed -and $Mode -notin @('Plan', 'Status')) { $report | ConvertTo-Json -Depth 12; exit 2 }
    if ($Mode -eq 'Prepare' -and $report.allowed) {
        Prepare-Runner $facts
        $initialAbsent = $facts.paths.rootAbsent
        $facts = Get-RunnerFacts
        $report = Invoke-Model $facts 'Status'
        $report.mode = 'Prepare'
        if (-not $report.allowed) { $report | ConvertTo-Json -Depth 12; exit 2 }
        $report.status = if ($initialAbsent) { 'prepared-stopped' } else { 'already-prepared-stopped' }
        $report.preparationPerformed = $initialAbsent
    } elseif ($Mode -eq 'Register' -and $report.allowed) {
        $wasRegistered = $facts.runner.registered
        Register-Runner $facts
        $facts = Get-RunnerFacts
        if (-not $facts.runner.registered -or -not $facts.runner.matches -or -not $facts.runner.protectedConfig) { throw 'Registered settings/credentials failed the protected repository/work-root/pin check; runner stays stopped.' }
        $report.status = 'registered-stopped'
        $report.registrationPerformed = -not $wasRegistered
    } elseif ($Mode -eq 'Run' -and $report.allowed) {
        $info = New-SanitizedProcess @('run') $facts
        $child = [Diagnostics.Process]::Start($info)
        $child.WaitForExit()
        exit $child.ExitCode
    } elseif ($Mode -eq 'Verify' -and $report.allowed -and $ExportEnvironment) {
        $envFile = $env:GITHUB_ENV
        $expected = "$Work\_temp\_runner_file_commands\"
        if (-not $envFile -or -not [IO.Path]::GetFullPath($envFile).StartsWith($expected, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $envFile -PathType Leaf) -or -not (Test-NoReparse $envFile)) { throw 'GITHUB_ENV must be a regular runner file-command path inside the fixed work root.' }
        foreach ($pair in $report.environment.GetEnumerator()) { [IO.File]::AppendAllText($envFile, "$($pair.Key)=$($pair.Value)`n", [Text.UTF8Encoding]::new($false)) }
        $report.environmentExported = $true
    }
    $report | ConvertTo-Json -Depth 12
    exit 0
} catch {
    # No exception object, environment, token, registration output or transcript dump.
    [Console]::Error.WriteLine("Windows runner $Mode stopped: $($_.Exception.Message)")
    exit 2
}
