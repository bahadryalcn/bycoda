function global:__BCEmit([string] $Payload) {
    [Console]::Write("$([char]27)]777;bycoda;__BYCODA_NONCE__;$Payload$([char]7)")
}
if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7) {
    __BCEmit 'unavailable'
    return
}
try {
    Import-Module PSReadLine -MinimumVersion 2.4 -ErrorAction Stop
    if ((Get-Command PSConsoleHostReadLine -ErrorAction Stop).ModuleName -ne 'PSReadLine') {
        throw 'Unsupported custom input host'
    }
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BycodaConsoleEcho {
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    public static bool Enabled() {
        uint mode;
        return GetConsoleMode(GetStdHandle(-10), out mode) && (mode & 4) != 0;
    }
}
'@
} catch {
    __BCEmit 'unavailable'
    return
}
$global:__BCU = [Environment]::UserName
$global:__BCH = [Environment]::MachineName
$global:__BCPS = 0L
$global:__BCRS = 0L
$global:__BCE = $false
$global:__BCA = $false
$global:__BCS = @('cd', 'git', 'ls', 'pwd', 'git status', 'git diff', 'git log --oneline')

function global:__BCLiteral([string]$v) {
    $v.Length -le 256 -and $v -cmatch '^[a-zA-Z0-9 ./_:-]*$' -and $v -notmatch 'password|passwd|secret|token|authorization|api_key|apikey|credential|\.env|\.ssh|private'
}
function global:__BCReviewed([string]$v) {
    (__BCLiteral $v) -and ($v -cmatch '^(cd|ls|pwd|git|docker|systemctl|ls -l|ls -la|git status|git diff|git log --oneline|docker ps|docker ps -a|systemctl status)$' -or $v -cmatch '^(cd|ls|systemctl status) [a-zA-Z0-9./_:][a-zA-Z0-9./_:-]*$')
}
function global:__BCRequest([string]$source) {
    ++$global:__BCRS
    $tuple = "$__BCPS;$__BCRS"
    if (-not $__BCA -or -not $__BCE) { __BCEmit "unavailable;$tuple"; return }
    $line=''; $cursor=0; $start=0; $length=0
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line,[ref]$cursor)
    [Microsoft.PowerShell.PSConsoleReadLine]::GetSelectionState([ref]$start,[ref]$length)
    if ($cursor -ne $line.Length -or $length -gt 0 -or -not (__BCLiteral $line)) { __BCEmit "no-match;$tuple"; return }
    $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($c in (Microsoft.PowerShell.Core\Get-Command -ListImported -CommandType Alias,Function,Cmdlet)) { [void]$names.Add($c.Name) }
    foreach ($d in ($env:PATH -split ';')) {
        if (-not $d) { continue }
        try { foreach($f in [IO.Directory]::EnumerateFiles($d.Trim('"'))) {
            if ([IO.Path]::GetExtension($f) -in @('.exe','.com','.cmd','.bat','.ps1')) { [void]$names.Add([IO.Path]::GetFileNameWithoutExtension($f)) }
        } } catch {}
    }
    $choices=[Collections.Generic.List[string]]::new()
    if($source -ne 'paths') {
        $h=[Microsoft.PowerShell.PSConsoleReadLine]::GetHistoryItems()
        for($i=$h.Length-1;$i -ge [Math]::Max(0,$h.Length-200);--$i) {
            $c=$h[$i].CommandLine
            if($source -ne 'reviewed' -or $__BCS -ccontains $c) { $choices.Add($c) }
        }
    }
    switch ($source) {
        commands {
            if ($line -cmatch '^[a-zA-Z0-9_.:-]*$' -and -not $line.StartsWith('-')) { $choices.AddRange([string[]]$names) }
            $choices.AddRange([string[]]($__BCS+@('docker ps','docker ps -a','systemctl status')))
        }
        paths {
            if ($line -cmatch '^(cd|ls) ([a-zA-Z0-9./_:-]*)$') {
                $lead=$Matches[1]+' '; $path=$Matches[2]
                $dir=[IO.Path]::GetDirectoryName($path); $leaf=[IO.Path]::GetFileName($path)
                if ($pwd.Provider.Name -ne 'FileSystem') { __BCEmit "no-match;$tuple"; return }
                if (-not $dir) { $dir=$pwd.ProviderPath } elseif (-not [IO.Path]::IsPathRooted($dir)) { $dir=[IO.Path]::Combine($pwd.ProviderPath,$dir) }
                try { foreach($f in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
                    $name=[IO.Path]::GetFileName($f)
                    if (-not $name.StartsWith($leaf,[StringComparison]::Ordinal)) { continue }
                    $entry=$path.Substring(0,$path.Length-$leaf.Length)+$name
                    $isDir=[IO.Directory]::Exists($f)
                    if ($lead -eq 'cd ' -and -not $isDir) { continue }
                    if($isDir) { $entry+='/' }
                    if(-not (__BCReviewed ($lead+$entry))) { continue }
                    $choices.Add($lead+$entry)
                    if($choices.Count -ge 64) { break }
                } } catch {}
            }
        }
        reviewed {
            $choices.AddRange([string[]]$__BCS)
        }
    }
    $out=[Collections.Generic.List[string]]::new()
    foreach($c in $choices) {
        if(-not (__BCLiteral $c) -or ($source -ne 'reviewed' -and $c -ceq $line) -or $c.StartsWith(' ') -or -not $c.StartsWith($line,[StringComparison]::Ordinal) -or $out.Contains($c)) { continue }
        if($source -ne 'paths' -and -not $names.Contains($c.Split(' ')[0])) { continue }
        $out.Add($c)
        if($out.Count -ge 12) { break }
    }
    if($out.Count -eq 0) { __BCEmit "no-match;$tuple"; return }
    __BCEmit "suggestions;$__BCU;$__BCH;$tuple;$cursor;$line;$($out -join "`t")"
}
Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+g' -ScriptBlock { __BCRequest reviewed }
Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+k' -ScriptBlock { __BCRequest commands }
Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p' -ScriptBlock { __BCRequest paths }
Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+y' -ScriptBlock { __BCRequest history }

function global:PSConsoleHostReadLine {
    [Diagnostics.DebuggerHidden()]
    param()
    $lastRunStatus = $?
    ++$global:__BCPS
    $global:__BCE = [BycodaConsoleEcho]::Enabled()
    $global:__BCA = $true
    if ($__BCE) {
        __BCEmit "ready;$__BCU;$__BCH;$__BCPS;$__BCRS"
    } else {
        __BCEmit "unavailable;$__BCPS;$__BCRS"
    }
    try {
        [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($host.Runspace, $ExecutionContext, $lastRunStatus)
    } finally {
        $global:__BCA = $false
        $global:__BCE = $false
        __BCEmit "busy;$__BCPS;$__BCRS"
    }
}
