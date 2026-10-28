import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test(
  "registered runner configuration can be read with Windows Hidden attributes",
  { skip: process.platform !== "win32" },
  () => {
    const root = path.resolve("temp/verification/2026-10-28-windows-runner/setup");
    mkdirSync(root, { recursive: true });
    const fixture = mkdtempSync(path.join(root, "hidden-config-"));
    const command = String.raw`$ErrorActionPreference='Stop'
$t=$null;$e=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/setup/windows-runner.ps1'),[ref]$t,[ref]$e)
if($e.Count){throw 'Runner source parse failed'}
foreach($name in @('Test-NoReparse','Read-JsonFile')) {
  $helper=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)|Select-Object -First 1
  Invoke-Expression $helper.Extent.Text
}
$file=Join-Path $env:BYCODA_HIDDEN_CONFIG_FIXTURE '.runner'
[IO.File]::WriteAllText($file,'{"agentName":"fixture-only"}')
[IO.File]::SetAttributes($file,[IO.FileAttributes]::Hidden)
if(-not (([IO.File]::GetAttributes($file)) -band [IO.FileAttributes]::Hidden)){throw 'Fixture not actually hidden'}
$original=Get-Acl -LiteralPath $file
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$readonly=Get-Acl -LiteralPath $file
$readonly.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::WriteAttributes,[Security.AccessControl.AccessControlType]::Deny))
Set-Acl -LiteralPath $file -AclObject $readonly
try {
  $attributes=[IO.File]::GetAttributes($file)
  $result=Read-JsonFile $file
  if($result.agentName -ne 'fixture-only'){throw 'Hidden runner configuration was not read'}
  if([IO.File]::GetAttributes($file) -ne $attributes){throw 'Reading configuration changed its attributes'}
} finally {Set-Acl -LiteralPath $file -AclObject $original}
if($null -ne (Read-JsonFile (Join-Path $env:BYCODA_HIDDEN_CONFIG_FIXTURE 'absent'))){throw 'Missing config was not absent'}
Write-Output '{"actualHiddenFile":true,"configurationRead":true}'`;
    const result = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, BYCODA_HIDDEN_CONFIG_FIXTURE: fixture },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      actualHiddenFile: true,
      configurationRead: true,
    });
  },
);

test(
  "firewall readiness accepts actual NetSecurity spellings and fails closed on incomplete or changed ranges",
  { skip: process.platform !== "win32" },
  () => {
    const command = String.raw`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/setup/windows-runner.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Runner source parse failed'}
$ranges=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$PrivateRanges'},$true)|Select-Object -First 1
Invoke-Expression $ranges.Extent.Text
$helper=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-PrivateEgressRanges'},$true)|Select-Object -First 1
Invoke-Expression $helper.Extent.Text
# Exact array read from the real dedicated guest, not a simulated network check.
$actual=@('10.0.0.0/255.0.0.0','172.16.0.0/255.240.0.0','192.168.0.0/255.255.0.0','169.254.0.0/255.255.0.0','100.64.0.0/255.192.0.0','fc00::/7','fe80::/10')
if(-not(Test-PrivateEgressRanges $actual)){throw 'Actual Windows spellings falsely rejected'}
if(-not(Test-PrivateEgressRanges $PrivateRanges)){throw 'Canonical policy CIDRs falsely rejected'}
$mixed=@($actual);$mixed[0]='10.0.0.0/8';$mixed[5]='FC00::/7'
if(-not(Test-PrivateEgressRanges $mixed)){throw 'Known mixed equivalent spellings falsely rejected'}
if(Test-PrivateEgressRanges @()){throw 'Empty policy accepted'}
for($i=0;$i -lt $actual.Count;$i++) {
  $missing=@($actual|Select-Object -First $i)+@($actual|Select-Object -Skip ($i+1))
  if(Test-PrivateEgressRanges $missing){throw 'Missing required network accepted'}
}
foreach($bad in @('10.0.0.0/9','10.0.0.0/7','11.0.0.0/8','10.0.0.0/255.0.255.0','10.0.0.1/255.0.0.0','0.0.0.0/0','Any','LocalSubnet','10.0.0.0-10.255.255.255',' 10.0.0.0/8','')) {
  $changed=@($actual);$changed[0]=$bad
  if(Test-PrivateEgressRanges $changed){throw 'Unknown/malformed/outside/broader/narrower mask accepted'}
}
foreach($bad in @('fc00::/8','fc00::/6','fd00::/7','fe80::/11','::/0')) {
  $changed=@($actual);$changed[5]=$bad
  if(Test-PrivateEgressRanges $changed){throw 'Different IPv6 policy accepted'}
}
$duplicate=@($actual);$duplicate[0]=$actual[1]
if(Test-PrivateEgressRanges $duplicate){throw 'Duplicate cannot substitute for missing network'}
if(Test-PrivateEgressRanges ($actual+@('Internet'))){throw 'Unknown additional alias accepted'}
Write-Output '{"actualEquivalent":true,"canonicalEquivalent":true,"missingAndChangedRejected":true,"networkMutations":false}'`;
    const result = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      actualEquivalent: true,
      canonicalEquivalent: true,
      missingAndChangedRejected: true,
      networkMutations: false,
    });
  },
);
