import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = fileURLToPath(new URL("./windows-vm-session.ps1", import.meta.url));
const windows = process.platform === "win32";
const invoke = (args) =>
  spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", source, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });

test(
  "guest desktop identity plan reads actual machine state without creating an account or task",
  { skip: !windows },
  () => {
    const result = invoke(["-Mode", "Plan"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    assert.equal(report.changed, false);
    assert.equal(report.mode, "Plan");
    assert.match(report.vmUuid, /^[a-f\d-]{36}$/i);
    assert.equal(typeof report.sessionTaskExists, "boolean");
  },
);

test(
  "PowerShell5.1 interop/layout, constructors and ownership/autologon guards without privileged calls",
  { skip: !windows },
  () => {
    const dir = path.resolve("temp/verification/2026-10-28-windows-runner/setup");
    mkdirSync(dir, { recursive: true });
    const fixture = mkdtempSync(path.join(dir, "session-"));
    const command = String.raw`$ErrorActionPreference='Stop'
$t=$null;$e=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:BYCODA_SESSION_SOURCE,[ref]$t,[ref]$e)
if($e.Count){throw 'PS5.1 parser failed'}
foreach($name in @('Assert-RegularPath','Get-EffectiveSessionRights','Assert-AdminProtected','Set-AdminOnly','Initialize-LsaInterop','Assert-OwnedMarker','Assert-WinlogonAvailable','Assert-SessionIdentity')) {
  $function=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)|Where-Object Name -eq $name
  Invoke-Expression $function.Extent.Text
}
# Compiles types and exercises marshaling metadata ONLY. No LSA calls occur.
Initialize-LsaInterop
if([BycodaGuestLsa]::CreateSecretAccess -ne 32 -or [BycodaGuestLsa]::ReadSecretAccess -ne 4){throw 'Wrong LSA policy access masks'}
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$key=[BycodaGuestLsa].GetMethod('MakeKey',$flags).Invoke($null,@())
try{if($key.Length -ne 30 -or $key.MaximumLength -ne 32 -or [Runtime.InteropServices.Marshal]::PtrToStringUni($key.Buffer) -ne 'DefaultPassword'){throw 'Wrong LSA key byte lengths'}}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($key.Buffer)}
$attrs=[BycodaGuestLsa].GetNestedType('Attributes',[Reflection.BindingFlags]::NonPublic)
$text=[BycodaGuestLsa].GetNestedType('Text',[Reflection.BindingFlags]::NonPublic)
if([Runtime.InteropServices.Marshal]::SizeOf([Type]$attrs) -ne 48 -or [Runtime.InteropServices.Marshal]::SizeOf([Type]$text) -ne 16){throw 'Wrong x64 native struct layout'}
$profileSource=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public static class BycodaGuestProfile'},$true)|Select-Object -First 1
Add-Type -TypeDefinition $profileSource.Value
$interop=[BycodaGuestProfile].GetMethod('CreateProfile').GetCustomAttributes([Runtime.InteropServices.DllImportAttribute],$false)[0]
if(-not $interop.ExactSpelling -or $interop.CharSet -ne [Runtime.InteropServices.CharSet]::Unicode){throw 'CreateProfile must bind exact Unicode native signature'}
if(([Text.StringBuilder]::new(1024)).Capacity -ne 1024){throw 'PS5.1 StringBuilder constructor binding failed'}
# Set-Acl is mocked: constructor binding/owner/rights are examined in memory.
function Set-Acl {param($LiteralPath,$AclObject) $script:captured=$AclObject}
foreach($target in @($env:BYCODA_SESSION_FIXTURE,$env:BYCODA_SESSION_SOURCE)) {
  Set-AdminOnly $target
  if($script:captured.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544' -or -not $script:captured.AreAccessRulesProtected){throw 'Protected ACL constructor/owner failed'}
  if($script:captured.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]).Count -ne 2){throw 'Protected ACL grants unexpected principals'}
}
Remove-Item Function:Set-Acl
# Current filesystem is never changed. Generic/inheritance ACLs are raw SDDL fixtures.
function Get-Acl {return $script:acl}
$script:acl=[Security.AccessControl.DirectorySecurity]::new()
$script:acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:(A;;GRGX;;;BU)(A;OICIIO;GA;;;CO)')
Assert-AdminProtected $env:BYCODA_SESSION_FIXTURE
$script:acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:(A;;GW;;;AU)')
$denied=$false;try{Assert-AdminProtected $env:BYCODA_SESSION_FIXTURE}catch{$denied=$true};if(-not $denied){throw 'Generic write ACL accepted'}
Remove-Item Function:Get-Acl
$computer=[pscustomobject]@{Name='BUILDGUEST';Manufacturer='Microsoft Corporation';Model='Virtual Machine';HypervisorPresent=$true}
$uuid='11111111-2222-3333-4444-555555555555'
Assert-SessionIdentity $computer $true 'BUILDGUEST\BycodaAdmin' $uuid $uuid
foreach($case in @(@($true,'DOMAIN\BycodaAdmin',$uuid,$uuid),@($false,'BUILDGUEST\BycodaAdmin',$uuid,$uuid),@($true,'BUILDGUEST\BycodaAdmin',$uuid,''),@($true,'BUILDGUEST\BycodaAdmin',$uuid,'00000000-0000-0000-0000-000000000000'))) {
  $denied=$false;try{Assert-SessionIdentity $computer $case[0] $case[1] $case[2] $case[3]}catch{$denied=$true};if(-not $denied){throw 'Untrusted guest identity accepted'}
}
# Registry reads are mocked and the guard never writes/removes an existing value.
$script:names=@();$script:auto='0'
$script:key=New-Object PSObject
$script:key|Add-Member ScriptMethod GetValueNames {return $script:names}
$script:key|Add-Member ScriptMethod GetValue {param($name,$fallback) return $script:auto}
$script:registryAcl=[Security.AccessControl.RegistrySecurity]::new()
$script:registryAcl.SetSecurityDescriptorSddlForm('O:BAG:BAD:(A;;KA;;;BA)(A;;KR;;;BU)')
function Get-Item {return $script:key}
function Get-Acl {return $script:registryAcl}
Assert-WinlogonAvailable
foreach($case in @(@(@('DefaultPassword'),'0'),@(@(),'1'))) {
  $script:names=$case[0];$script:auto=$case[1]
  $denied=$false;try{Assert-WinlogonAvailable}catch{$denied=$true};if(-not $denied){throw 'Existing plaintext/autologon state accepted'}
}
Write-Output '{"ps51Interop":"pass","nativeCalls":false,"aclConstructors":"pass","identityGuards":"pass","existingAutologonRetained":true}'`;
    const result = spawnSync(
      "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, BYCODA_SESSION_SOURCE: source, BYCODA_SESSION_FIXTURE: fixture },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      ps51Interop: "pass",
      nativeCalls: false,
      aclConstructors: "pass",
      identityGuards: "pass",
      existingAutologonRetained: true,
    });
  },
);

test(
  "guest desktop identity refuses mutation without the exact expected VM, before provisioning paths",
  { skip: !windows },
  () => {
    for (const mode of ["CreateAccount", "EnableRunnerSession"]) {
      const result = invoke([
        "-Mode",
        mode,
        "-ExpectedVmUuid",
        "00000000-0000-0000-0000-000000000000",
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /exact new VM/);
      assert.doesNotMatch(result.stdout, /password|DefaultPassword/i);
    }
  },
);
