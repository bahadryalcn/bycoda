[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Create', 'Status')][string]$Mode = 'Plan',
    [string]$VmName = 'bycoda-windows-ci',
    [string]$VmRoot = 'G:\BycodaCI\VMs\bycoda-windows-ci',
    [string]$IsoPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bycoda-ci\bootstrap\windows11-26h2-eval-x64\windows11-enterprise-eval-26h2-en-us.iso'),
    [string]$AdminPasswordFile,
    [string]$MetadataFile
)

# Offline installation only into a new owned VHD. No host boot, account, switch,
# licensing or activation settings are changed. The parent operator runs Create.
# https://learn.microsoft.com/windows-hardware/manufacture/desktop/windows-setup-automation-overview
# https://learn.microsoft.com/windows-hardware/manufacture/desktop/bcdboot-command-line-options-techref-di
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# A Windows PowerShell child launched by pwsh can inherit PowerShell 7 module
# paths. Use only its native Windows modules in this process, including DISM,
# Hyper-V and Security; never modify the host/user environment persistently.
if ($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
$script:VmOwner = 'bycoda-windows-ci-v1'
$script:VmIsoHash = 'bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38'
$script:VmControllerRoot = 'C:\ProgramData\BycodaCIController'
$script:VmCredentialPath = Join-Path $script:VmControllerRoot 'bycoda-windows-ci.admin.credential.xml'

function Assert-VmCondition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Get-VmCanonicalPath([string]$Value) {
    Assert-VmCondition (-not [string]::IsNullOrWhiteSpace($Value) -and $Value -match '^[a-zA-Z]:[\\/]' -and $Value -notmatch '[\x00-\x1f<>"|?*]' -and $Value.Substring(2) -notmatch ':') 'Expected an absolute local filesystem path.'
    Assert-VmCondition (-not (($Value -split '[\\/]') -contains '..')) 'Parent traversal is forbidden.'
    return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/')
}
function Assert-VmNoReparse([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        try {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            Assert-VmCondition (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'A guarded path has a reparse-point ancestor.'
        } catch [System.Management.Automation.ItemNotFoundException] { }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Resolve-VmOwnedPaths([string]$Name, [string]$Root, [string]$Iso, [object]$Fixture = $null) {
    Assert-VmCondition ($Name -ceq 'bycoda-windows-ci') 'Only the authorized new VM name is supported.'
    $canonicalRoot = Get-VmCanonicalPath $Root
    Assert-VmCondition ($canonicalRoot -ieq 'G:\BycodaCI\VMs\bycoda-windows-ci') 'VM root must be the exact authorized owned directory.'
    $canonicalIso = Get-VmCanonicalPath $Iso
    Assert-VmCondition ([IO.Path]::GetExtension($canonicalIso) -ieq '.iso') 'Installation media must be an ISO file.'
    Assert-VmCondition (-not $canonicalIso.StartsWith('G:\BycodaCI\', [StringComparison]::OrdinalIgnoreCase)) 'Media must be outside the newly owned VM tree.'
    $paths = [ordered]@{ root = $canonicalRoot; ownedRoot = 'G:\BycodaCI'; controllerRoot = $script:VmControllerRoot; credential = $script:VmCredentialPath; iso = $canonicalIso; vhd = (Join-Path $canonicalRoot 'system.vhdx'); marker = (Join-Path $canonicalRoot 'owner.json'); journal = (Join-Path $canonicalRoot 'journal.json') }
    if ($null -eq $Fixture) {
        foreach ($guarded in @($paths.root, $paths.controllerRoot, $paths.iso)) { Assert-VmNoReparse $guarded }
    } else {
        foreach ($reparse in @($Fixture.reparsePaths)) {
            $unsafe = Get-VmCanonicalPath ([string]$reparse)
            foreach ($guarded in @($paths.root, $paths.controllerRoot, $paths.iso)) {
                Assert-VmCondition (-not ($guarded -ieq $unsafe -or $guarded.StartsWith($unsafe + '\', [StringComparison]::OrdinalIgnoreCase))) 'Fixture detects a guarded reparse-point ancestor.'
            }
        }
    }
    return [pscustomobject]$paths
}
function Test-VmElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Set-VmProtectedAcl([string]$Path, [switch]$Directory) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $identity = [Security.Principal.SecurityIdentifier]::new($sid)
        $rule = if ($Directory) { [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow') } else { [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow') }
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-VmProtectedAcl([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    Assert-VmCondition $acl.AreAccessRulesProtected 'Sensitive metadata must not inherit broad permissions.'
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    Assert-VmCondition ($owner -in @('S-1-5-18', 'S-1-5-32-544')) 'Sensitive metadata owner must be SYSTEM or Administrators.'
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow') { Assert-VmCondition ($rule.IdentityReference.Value -in @('S-1-5-18', 'S-1-5-32-544')) 'Sensitive metadata grants an unexpected principal access.' }
    }
}
function Assert-VmPasswordAccessDescriptor([object]$Acl, [string]$ActorSid) {
    $allowed = @('S-1-5-18', 'S-1-5-32-544', $ActorSid)
    Assert-VmCondition ($Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in $allowed) 'Password delivery file has an unexpected owner.'
    foreach ($rule in $Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow') { Assert-VmCondition ($rule.IdentityReference.Value -in $allowed) 'Password delivery file grants an unexpected principal access.' }
    }
}
function Assert-VmPasswordInputAcl([string]$Path) {
    # The app owns this one-use delivery file. Accept its current-actor-only ACL
    # without changing it; controller outputs retain the stricter Admin/SYSTEM ACL.
    $acl = Get-Acl -LiteralPath $Path
    $actor = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Assert-VmPasswordAccessDescriptor $acl $actor
}
function Read-VmJson([string]$Path) {
    Assert-VmNoReparse $Path
    $item = Get-Item -LiteralPath $Path -Force
    Assert-VmCondition (-not $item.PSIsContainer -and $item.Length -gt 0 -and $item.Length -le 1MB) 'Metadata must be bounded regular JSON.'
    return ([IO.File]::ReadAllText($item.FullName) | ConvertFrom-Json)
}
function Write-VmJson([string]$Path, [object]$Value, [switch]$NewOnly) {
    Assert-VmNoReparse $Path
    if ($NewOnly) { Assert-VmCondition (-not (Test-Path -LiteralPath $Path)) 'Owned metadata already exists.' }
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    # Windows PowerShell 5.1 coerces $null to an empty string for this .NET
    # overload. NullString preserves a real null optional backup filename.
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) } else { [IO.File]::Move($temporary, $Path) }
}
function Get-VmLiveMetadata([object]$Paths, [switch]$HashIso) {
    $metadata = [ordered]@{ elevated = (Test-VmElevated); hyperVAvailable = $false; vmQuerySucceeded = $false; vmExists = $null; switchExists = $false; availableMemoryBytes = 0L; logicalProcessors = 0; driveType = 'Unknown'; driveFreeBytes = 0L; ownedRootExists = (Test-Path -LiteralPath $Paths.ownedRoot); ownedRootOwned = $false; vmRootExists = (Test-Path -LiteralPath $Paths.root); controllerRootExists = (Test-Path -LiteralPath $Paths.controllerRoot); controllerRootOwned = $false; credentialExists = (Test-Path -LiteralPath $Paths.credential); isoExists = $false; isoHash = $null; reparsePaths = @() }
    $metadata.hyperVAvailable = $null -ne (Get-Command New-VM -ErrorAction SilentlyContinue)
    if ($metadata.hyperVAvailable) {
        try { $matches = @(Get-VM -ErrorAction Stop | Where-Object Name -CEQ 'bycoda-windows-ci'); $metadata.vmExists = $matches.Count -gt 0; $metadata.vmQuerySucceeded = $true; $metadata.switchExists = @(Get-VMSwitch -ErrorAction Stop | Where-Object Name -CEQ 'Default Switch').Count -eq 1 } catch { $metadata.vmQuerySucceeded = $false }
    }
    try { $os = Get-CimInstance Win32_OperatingSystem; $system = Get-CimInstance Win32_ComputerSystem; $metadata.availableMemoryBytes = [long]$os.FreePhysicalMemory * 1KB; $metadata.logicalProcessors = [int]$system.NumberOfLogicalProcessors } catch { }
    try { $drive = [IO.DriveInfo]::new('G:\'); $metadata.driveType = $drive.DriveType.ToString(); $metadata.driveFreeBytes = $drive.AvailableFreeSpace } catch { }
    foreach ($entry in @(@{ path = $Paths.ownedRoot; exists = 'ownedRootExists'; owned = 'ownedRootOwned' }, @{ path = $Paths.controllerRoot; exists = 'controllerRootExists'; owned = 'controllerRootOwned' })) {
        if ($metadata[$entry.exists]) { try { $marker = Read-VmJson (Join-Path $entry.path 'owner.json'); Assert-VmProtectedAcl $entry.path; $metadata[$entry.owned] = $marker.owner -ceq $script:VmOwner -and $marker.root -ieq $entry.path } catch { } }
    }
    if (Test-Path -LiteralPath $Paths.iso -PathType Leaf) {
        $metadata.isoExists = $true
        if ($HashIso) { $metadata.isoHash = (Get-FileHash -LiteralPath $Paths.iso -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    return [pscustomobject]$metadata
}
function Get-VmPlan([object]$Paths, [object]$Snapshot, [bool]$Simulation) {
    $reasons = [Collections.Generic.List[string]]::new()
    if (-not $Snapshot.elevated) { $reasons.Add('Administrator elevation required for Create.') }
    if (-not $Snapshot.hyperVAvailable -or -not $Snapshot.vmQuerySucceeded) { $reasons.Add('Hyper-V state is unavailable; absence of a VM is not proven.') }
    if ($null -eq $Snapshot.vmExists -or $Snapshot.vmExists -ne $false -or $Snapshot.vmRootExists) { $reasons.Add('Existing or unknown VM/root must never be overwritten.') }
    if (-not $Snapshot.switchExists) { $reasons.Add('Existing Default Switch is required; no host networking changes are permitted.') }
    if ($Snapshot.driveType -ne 'Fixed' -or [long]$Snapshot.driveFreeBytes -lt 48GB) { $reasons.Add('G: must be a fixed local drive with at least 48GiB initially free.') }
    if ([long]$Snapshot.availableMemoryBytes -lt 14GB -or [int]$Snapshot.logicalProcessors -lt 8) { $reasons.Add('Need at least 14GiB free host RAM and 8 logical processors before startup.') }
    if (-not $Snapshot.isoExists -or $Snapshot.isoHash -cne $script:VmIsoHash) { $reasons.Add('Official evaluation ISO is unavailable or its SHA256 is not verified.') }
    if ($Snapshot.credentialExists) { $reasons.Add('Existing protected controller credential must not be overwritten.') }
    if (($Snapshot.ownedRootExists -and -not $Snapshot.ownedRootOwned) -or ($Snapshot.controllerRootExists -and -not $Snapshot.controllerRootOwned)) { $reasons.Add('Existing parent/controller directories lack verified ownership and protected ACLs.') }
    return [pscustomobject][ordered]@{ schemaVersion = 1; mode = 'Plan'; simulation = $Simulation; canCreate = (-not $Simulation -and $reasons.Count -eq 0); snapshotReady = ($reasons.Count -eq 0); vmName = 'bycoda-windows-ci'; paths = $Paths; resources = @{ generation = 2; processors = 8; startupMemoryBytes = 8GB; minimumMemoryBytes = 4GB; maximumMemoryBytes = 12GB; dynamicVhdBytes = 160GB; switch = 'Default Switch'; secureBoot = 'MicrosoftWindows'; virtualTpm = $true }; reasons = $reasons.ToArray(); licensing = 'Windows 11 Enterprise Evaluation, 90 days; guest trial expiry must be recorded after installation. No activation bypass.'; credentials = 'Create requires a protected one-use AdminPasswordFile; plaintext/XML is never returned.' }
}
function New-VmOwnerDirectory([string]$Path, [string]$MarkerName) {
    Assert-VmNoReparse $Path
    if (Test-Path -LiteralPath $Path) {
        $marker = Read-VmJson (Join-Path $Path $MarkerName)
        Assert-VmCondition ($marker.owner -ceq $script:VmOwner -and $marker.root -ieq $Path) 'Existing directory has no matching ownership marker.'
        Assert-VmProtectedAcl $Path
        return
    }
    New-Item -ItemType Directory -Path $Path | Out-Null
    Set-VmProtectedAcl -Path $Path -Directory
    Write-VmJson -Path (Join-Path $Path $MarkerName) -Value @{ owner = $script:VmOwner; root = $Path; createdAt = [DateTime]::UtcNow.ToString('o') } -NewOnly
}
function Assert-VmOwnedDisk([string]$VhdPath, [int]$DiskNumber) {
    Assert-VmNoReparse $VhdPath
    $vhd = Get-VHD -Path $VhdPath
    Assert-VmCondition ($vhd.Attached -and $vhd.DiskNumber -eq $DiskNumber -and $vhd.Path -ieq $VhdPath) 'Mounted disk does not belong to the exact newly created VHD.'
    $disk = Get-Disk -Number $DiskNumber
    Assert-VmCondition (-not $disk.IsBoot -and -not $disk.IsSystem) 'Host boot/system disks are forbidden.'
    return $disk
}
function New-VmUnattendXml([string]$Password) {
    Assert-VmCondition ($Password.Length -ge 16 -and $Password.Length -le 127 -and $Password -notmatch '[\x00-\x1f\x7f]') 'Bootstrap password must be a bounded single-line strong secret.'
    $escaped = [Security.SecurityElement]::Escape($Password)
    return @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="specialize"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>BYCODA-CI-VM</ComputerName><TimeZone>UTC</TimeZone></component></settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>1</ProtectYourPC></OOBE>
      <UserAccounts><LocalAccounts><LocalAccount wcm:action="add"><Password><Value>$escaped</Value><PlainText>true</PlainText></Password><Description>Temporary isolated VM bootstrap administrator</Description><DisplayName>BycodaAdmin</DisplayName><Group>Administrators</Group><Name>BycodaAdmin</Name></LocalAccount></LocalAccounts></UserAccounts>
    </component>
  </settings>
</unattend>
"@
}
function Invoke-VmCreate([object]$Paths) {
    Assert-VmCondition (Test-VmElevated) 'Create requires an elevated administrator.'
    $snapshot = Get-VmLiveMetadata $Paths -HashIso
    $plan = Get-VmPlan $Paths $snapshot $false
    Assert-VmCondition $plan.canCreate ('Create prerequisites failed: ' + ($plan.reasons -join ' '))
    Assert-VmCondition (-not [string]::IsNullOrWhiteSpace($AdminPasswordFile)) 'Create requires a protected one-use AdminPasswordFile.'
    $passwordPath = Get-VmCanonicalPath $AdminPasswordFile
    Assert-VmNoReparse $passwordPath
    $passwordInfo = Get-Item -LiteralPath $passwordPath -Force
    Assert-VmCondition (-not $passwordInfo.PSIsContainer -and $passwordInfo.Length -gt 0 -and $passwordInfo.Length -le 4096 -and $passwordPath -ine $Paths.credential) 'Invalid protected one-use password file.'
    Assert-VmPasswordInputAcl $passwordPath
    # Validate directory ownership before reading the secret or making resources.
    if ($snapshot.ownedRootExists) { $existing = Read-VmJson (Join-Path $Paths.ownedRoot 'owner.json'); Assert-VmCondition ($existing.owner -ceq $script:VmOwner -and $existing.root -ieq $Paths.ownedRoot) 'Existing G:\BycodaCI root is not owned by this controller.'; Assert-VmProtectedAcl $Paths.ownedRoot }
    if ($snapshot.controllerRootExists) { $existing = Read-VmJson (Join-Path $Paths.controllerRoot 'owner.json'); Assert-VmCondition ($existing.owner -ceq $script:VmOwner -and $existing.root -ieq $Paths.controllerRoot) 'Existing controller root is not owned by this controller.'; Assert-VmProtectedAcl $Paths.controllerRoot }
    $secret = [IO.File]::ReadAllText($passwordPath, [Text.UTF8Encoding]::new($false, $true)) -replace '\r?\n\z', ''
    $unattend = New-VmUnattendXml $secret
    $secure = ConvertTo-SecureString -String $secret -AsPlainText -Force
    $credential = [Management.Automation.PSCredential]::new('BycodaAdmin', $secure)
    $secret = $null
    $mountedIsoByUs = $false; $mountedVhdByUs = $false; $journal = $null
    try {
        New-VmOwnerDirectory $Paths.ownedRoot 'owner.json'
        New-VmOwnerDirectory $Paths.controllerRoot 'owner.json'
        Assert-VmCondition (-not (Test-Path -LiteralPath $Paths.root)) 'VM root appeared concurrently; refusing overwrite.'
        New-Item -ItemType Directory -Path $Paths.root | Out-Null
        Set-VmProtectedAcl -Path $Paths.root -Directory
        Write-VmJson $Paths.marker @{ owner = $script:VmOwner; root = $Paths.root; vmName = 'bycoda-windows-ci'; createdAt = [DateTime]::UtcNow.ToString('o') } -NewOnly
        $journal = [ordered]@{ schemaVersion = 1; owner = $script:VmOwner; vmName = 'bycoda-windows-ci'; root = $Paths.root; vmId = $null; state = 'creating'; stage = 'credential'; isoSha256 = $script:VmIsoHash; imageIndex = $null; imageVersion = $null; credentialPath = $Paths.credential; sensitiveUnattendCleanupRequired = $true; startedAt = [DateTime]::UtcNow.ToString('o') }
        Write-VmJson $Paths.journal $journal -NewOnly
        Assert-VmCondition (-not (Test-Path -LiteralPath $Paths.credential)) 'Credential target appeared concurrently; refusing overwrite.'
        $credential | Export-Clixml -LiteralPath $Paths.credential
        Set-VmProtectedAcl $Paths.credential
        Assert-VmProtectedAcl $Paths.credential
        $credential = $null; $secure = $null
        $journal.stage = 'mount-iso'; Write-VmJson $Paths.journal $journal
        $iso = Get-DiskImage -ImagePath $Paths.iso
        if (-not $iso.Attached) { $iso = Mount-DiskImage -ImagePath $Paths.iso -StorageType ISO -Access ReadOnly -PassThru; $mountedIsoByUs = $true }
        $volumes = @($iso | Get-Volume | Where-Object { $_.DriveLetter })
        Assert-VmCondition ($volumes.Count -eq 1) 'ISO must expose exactly one drive-letter volume.'
        $wim = Join-Path ($volumes[0].DriveLetter.ToString() + ':\') 'sources\install.wim'
        Assert-VmCondition (Test-Path -LiteralPath $wim -PathType Leaf) 'Official install.wim is missing.'
        $images = @(Get-WindowsImage -ImagePath $wim)
        Assert-VmCondition ($images.Count -gt 0 -and $images.Count -le 100) 'Invalid install.wim index inventory.'
        $eligible = @($images | ForEach-Object { Get-WindowsImage -ImagePath $wim -Index $_.ImageIndex } | Where-Object { $_.EditionId -ceq 'EnterpriseEval' -and $_.Architecture -in @(9, 'amd64', 'x64') })
        Assert-VmCondition ($eligible.Count -eq 1) 'Expected exactly one amd64 EnterpriseEval image index.'
        $journal.imageIndex = [int]$eligible[0].ImageIndex; $journal.imageVersion = $eligible[0].Version.ToString()
        $journal.stage = 'create-vhd'; Write-VmJson $Paths.journal $journal
        New-VHD -Path $Paths.vhd -SizeBytes 160GB -Dynamic | Out-Null
        Mount-VHD -Path $Paths.vhd -NoDriveLetter | Out-Null; $mountedVhdByUs = $true
        $diskNumber = [int](Get-VHD -Path $Paths.vhd).DiskNumber
        $disk = Assert-VmOwnedDisk $Paths.vhd $diskNumber
        Assert-VmCondition ($disk.PartitionStyle -eq 'RAW') 'New VHD is not blank; refusing disk initialization.'
        Initialize-Disk -Number $diskNumber -PartitionStyle GPT | Out-Null
        Assert-VmOwnedDisk $Paths.vhd $diskNumber | Out-Null
        $efi = New-Partition -DiskNumber $diskNumber -Size 260MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' -AssignDriveLetter
        Format-Volume -DriveLetter $efi.DriveLetter -FileSystem FAT32 -NewFileSystemLabel 'System' -Confirm:$false -Force | Out-Null
        New-Partition -DiskNumber $diskNumber -Size 16MB -GptType '{e3c9e316-0b5c-4db8-817d-f92df00215ae}' | Out-Null
        $os = New-Partition -DiskNumber $diskNumber -UseMaximumSize -AssignDriveLetter
        Assert-VmOwnedDisk $Paths.vhd $diskNumber | Out-Null
        Format-Volume -DriveLetter $os.DriveLetter -FileSystem NTFS -NewFileSystemLabel 'Windows' -Confirm:$false -Force | Out-Null
        $osRoot = $os.DriveLetter.ToString() + ':\'
        $journal.stage = 'apply-image'; Write-VmJson $Paths.journal $journal
        Expand-WindowsImage -ImagePath $wim -Index $journal.imageIndex -ApplyPath $osRoot -CheckIntegrity -Verify -LogPath (Join-Path $Paths.root 'dism-apply.log') | Out-Null
        $journal.stage = 'configure-offline'; Write-VmJson $Paths.journal $journal
        Assert-VmOwnedDisk $Paths.vhd $diskNumber | Out-Null
        $panther = Join-Path $osRoot 'Windows\Panther'
        if (-not (Test-Path -LiteralPath $panther)) { New-Item -ItemType Directory -Path $panther | Out-Null }
        $answerFile = Join-Path $panther 'unattend.xml'
        Assert-VmNoReparse $answerFile
        $emptyAnswer = [IO.File]::Open($answerFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $emptyAnswer.Dispose()
        Set-VmProtectedAcl $answerFile; Assert-VmProtectedAcl $answerFile
        [IO.File]::WriteAllText($answerFile, $unattend, [Text.UTF8Encoding]::new($false))
        $unattend = $null
        Remove-Item -LiteralPath $passwordPath -Force
        $journal.passwordFileConsumed = $true; Write-VmJson $Paths.journal $journal
        $boot = Join-Path $env:WINDIR 'System32\bcdboot.exe'
        & $boot (Join-Path $osRoot 'Windows') /s ($efi.DriveLetter.ToString() + ':') /f UEFI /l en-US | Out-Null
        Assert-VmCondition ($LASTEXITCODE -eq 0) 'Offline UEFI boot file creation failed.'
        Assert-VmCondition (Test-Path -LiteralPath (Join-Path ($efi.DriveLetter.ToString() + ':\') 'EFI\Microsoft\Boot\BCD')) 'Offline EFI BCD store is missing.'
        Dismount-VHD -Path $Paths.vhd; $mountedVhdByUs = $false
        if ($mountedIsoByUs) { Dismount-DiskImage -ImagePath $Paths.iso; $mountedIsoByUs = $false }
        $journal.stage = 'define-vm'; Write-VmJson $Paths.journal $journal
        Assert-VmCondition (@(Get-VM | Where-Object Name -CEQ 'bycoda-windows-ci').Count -eq 0) 'VM name appeared concurrently; refusing overwrite.'
        $vm = New-VM -Name 'bycoda-windows-ci' -Generation 2 -MemoryStartupBytes 8GB -VHDPath $Paths.vhd -Path $Paths.root -SwitchName 'Default Switch'
        $journal.vmId = $vm.Id.ToString(); Write-VmJson $Paths.journal $journal
        Set-VMProcessor -VMName 'bycoda-windows-ci' -Count 8
        Set-VMMemory -VMName 'bycoda-windows-ci' -DynamicMemoryEnabled $true -StartupBytes 8GB -MinimumBytes 4GB -MaximumBytes 12GB
        Set-VM -Name 'bycoda-windows-ci' -AutomaticStartAction Nothing -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false
        $bootDisk = @(Get-VMHardDiskDrive -VMName 'bycoda-windows-ci')
        Assert-VmCondition ($bootDisk.Count -eq 1 -and $bootDisk[0].Path -ieq $Paths.vhd) 'VM boot disk identity differs.'
        Set-VMFirmware -VMName 'bycoda-windows-ci' -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice $bootDisk[0]
        Set-VMKeyProtector -VMName 'bycoda-windows-ci' -NewLocalKeyProtector
        Enable-VMTPM -VMName 'bycoda-windows-ci'
        $virtualIdentity = ([Security.Principal.NTAccount]::new('NT VIRTUAL MACHINE', $journal.vmId)).Translate([Security.Principal.SecurityIdentifier])
        $vmAcl = Get-Acl -LiteralPath $Paths.root
        $vmAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($virtualIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        Set-Acl -LiteralPath $Paths.root -AclObject $vmAcl
        $journal.stage = 'start-vm'; Write-VmJson $Paths.journal $journal
        $freshOs = Get-CimInstance Win32_OperatingSystem
        Assert-VmCondition (([long]$freshOs.FreePhysicalMemory * 1KB) -ge 14GB) 'Host memory fell below the safe startup threshold; VM retained off.'
        Start-VM -Name 'bycoda-windows-ci'
        $journal.state = 'started'; $journal.stage = 'await-guest-oobe'; $journal.completedAt = [DateTime]::UtcNow.ToString('o'); Write-VmJson $Paths.journal $journal
        return [pscustomobject]@{ schemaVersion = 1; mode = 'Create'; state = $journal.state; vmName = $journal.vmName; vmId = $journal.vmId; journalPath = $Paths.journal; credentialPath = $Paths.credential; pending = 'Verify guest/OOBE via PowerShell Direct, record actual evaluation expiry, and remove sensitive Panther answer files. Runner is not installed or activated.' }
    } catch {
        if ($null -ne $journal) { $journal.state = 'failed'; $journal.failureType = $_.Exception.GetType().FullName; try { Write-VmJson $Paths.journal $journal } catch { } }
        throw ('Owned VM creation failed at stage [{0}]; partial owned resources retained for review. Exception type: {1}' -f $(if ($null -ne $journal) { $journal.stage } else { 'owned-directory' }), $_.Exception.GetType().FullName)
    } finally {
        $secret = $null; $unattend = $null; $credential = $null; $secure = $null
        if ($mountedVhdByUs) { Dismount-VHD -Path $Paths.vhd -ErrorAction Continue }
        if ($mountedIsoByUs) { Dismount-DiskImage -ImagePath $Paths.iso -ErrorAction Continue }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Assert-VmCondition (-not $MetadataFile -or $Mode -eq 'Plan') 'Metadata fixtures are allowed only for readonly Plan.'
    $fixture = if ($MetadataFile) { Read-VmJson (Get-VmCanonicalPath $MetadataFile) } else { $null }
    $paths = Resolve-VmOwnedPaths $VmName $VmRoot $IsoPath $fixture
    if ($Mode -eq 'Create') { Invoke-VmCreate $paths | ConvertTo-Json -Depth 12 }
    elseif ($Mode -eq 'Plan') {
        $snapshot = if ($null -ne $fixture) { $fixture } else { Get-VmLiveMetadata $paths -HashIso }
        Get-VmPlan $paths $snapshot ($null -ne $fixture) | ConvertTo-Json -Depth 12
    } else {
        $marker = if (Test-Path -LiteralPath $paths.marker) { Read-VmJson $paths.marker } else { $null }
        $journal = if (Test-Path -LiteralPath $paths.journal) { Read-VmJson $paths.journal } else { $null }
        $vm = $null; $query = 'unknown'
        try { $vm = @(Get-VM | Where-Object Name -CEQ 'bycoda-windows-ci'); $query = 'available' } catch { }
        $owned = $null -ne $marker -and $marker.owner -ceq $script:VmOwner -and $null -ne $journal -and $journal.owner -ceq $script:VmOwner
        $matched = $owned -and $query -eq 'available' -and $vm.Count -eq 1 -and $journal.vmId -eq $vm[0].Id.ToString()
        [pscustomobject]@{ schemaVersion = 1; mode = 'Status'; vmName = 'bycoda-windows-ci'; root = $paths.root; ownerMarker = $owned; vmIdentityMatches = $matched; hyperVQuery = $query; state = $(if ($matched) { $vm[0].State.ToString() } else { 'unknown' }); journalStage = $(if ($owned) { $journal.stage } else { $null }); vmId = $(if ($owned) { $journal.vmId } else { $null }); credentialPath = $paths.credential; guestInstallation = 'unverified'; runner = 'not-verified-or-activated-by-this-script' } | ConvertTo-Json -Depth 8
    }
}
