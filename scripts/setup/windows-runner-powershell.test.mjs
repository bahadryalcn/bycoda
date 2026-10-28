import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { windowsContext } from "../checks/windows-runner-policy-fixtures.mjs";

test(
  "actual PowerShell archive/path guards and compiled profile-free shell preserve argv and exit",
  { skip: process.platform !== "win32" },
  () => {
    const evidence = path.resolve("temp/verification/2026-10-28-windows-runner/setup");
    mkdirSync(evidence, { recursive: true });
    const fixture = mkdtempSync(path.join(evidence, "fixture-"));
    const command = String.raw`
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/setup/windows-runner.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Setup parse failed'}
# Load only guards/compiler, never the setup entrypoint or provisioning commands.
foreach($name in @('Test-NoReparse','Test-Protected','Get-EffectiveFileRights','Assert-SafeArchive','New-ProfileFreeShim','Invoke-CleanTool','New-SanitizedProcess')) {
  $definition=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)|Where-Object Name -eq $name
  Invoke-Expression $definition.Extent.Text
}
$Control=$env:BYCODA_RUNNER_FIXTURE
$WindowsRoot=[Environment]::GetFolderPath('Windows')
$Agent="$Control\agent"; $Cache="$Control\cache"
$AdminSid='S-1-5-32-544'; $SystemSid='S-1-5-18'; $TrustedInstallerSid='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
New-Item -ItemType Directory -Path "$Control\shell","$Control\ordinary"|Out-Null
if(-not(Test-NoReparse "$Control\ordinary")){throw 'Regular path rejected'}
if(Test-Protected "$Control\ordinary"){throw 'User-writable fixture falsely called protected'}
if(-not(Test-Protected "$WindowsRoot\System32\cmd.exe" -Ancestors)){throw 'System-owned executable with harmless reader ACEs falsely rejected'}
if(-not(Test-Protected 'C:\Program Files\PowerShell\7\pwsh.exe' -Ancestors)){throw 'Protected PS7 ancestry falsely rejected (including CREATOR OWNER InheritOnly)'}
# In-memory raw Windows ACLs exercise actual generic and inheritance flags,
# without changing any system or fixture directory permissions.
function Get-Acl { return $script:fakeAcl }
foreach($case in @(@('O:BAG:BAD:(A;;GRGX;;;BU)(A;OICIIO;GA;;;CO)',$true),@('O:BAG:BAD:(A;;GW;;;AU)',$false),@('O:BAG:BAD:(A;;GA;;;AU)',$false),@('O:BAG:BAD:(A;OICIID;GA;;;AU)',$false))) {
  $script:fakeAcl=[Security.AccessControl.DirectorySecurity]::new()
  $script:fakeAcl.SetSecurityDescriptorSddlForm($case[0])
  if((Test-Protected "$Control\ordinary") -ne $case[1]){throw 'Effective generic/inherited ACL decision was wrong'}
}
Remove-Item Function:Get-Acl
# A leaf's read-only ACL is insufficient if an ancestor can be renamed.
# Give its parent DELETE and the grandparent ADD_SUBDIRECTORY in memory only.
function Get-Acl {param($LiteralPath)
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $sddl=if($LiteralPath -eq $Control){'O:BAG:BAD:(A;;SD;;;AU)'}elseif($LiteralPath -eq (Split-Path -Parent $Control)){'O:BAG:BAD:(A;;0x00000004;;;AU)'}else{'O:BAG:BAD:(A;;GRGX;;;BU)'}
  $acl.SetSecurityDescriptorSddlForm($sddl);return $acl
}
if(Test-Protected "$Control\ordinary" -Ancestors){throw 'Read-only leaf accepted behind a deletable/replaceable ancestor'}
Remove-Item Function:Get-Acl
if(Test-NoReparse 'C:\tmp\file:stream'){throw 'ADS path accepted'}
if(Test-NoReparse '\\server\share'){throw 'UNC path accepted'}
New-Item -ItemType Junction -Path "$Control\linked" -Target "$Control\ordinary"|Out-Null
if(Test-NoReparse "$Control\linked\missing"){throw 'Ancestor junction accepted'}
$poison="$Control\poison.cjs"
[IO.File]::WriteAllText($poison,'throw new Error("NODE_OPTIONS executed before decision")')
$env:NODE_OPTIONS='--require "'+$poison+'"'
$env:NODE_PATH=$Control; $env:DOTNET_STARTUP_HOOKS='untrusted.dll'
$probe=Invoke-CleanTool $env:BYCODA_RUNNER_TEST_NODE @('--version')
if($probe.exitCode -ne 0 -or $probe.output -notmatch '^v\d+\.'){throw 'Clean tool inherited Node startup injection'}
function Invoke-Model { return @{environment=@{CARGO_HOME="$Cache\cargo-home"}} }
$launch=New-SanitizedProcess @('run') @{current=@{profile='C:\Users\bycoda-runner'}}
foreach($name in @('NODE_OPTIONS','NODE_PATH','DOTNET_STARTUP_HOOKS')){if($launch.Environment.ContainsKey($name)){throw 'Inherited loader environment reached Listener'}}
if(-not $launch.Environment['PATH'].StartsWith("$Control\shell;")){throw 'Protected shell lost first PATH position'}
Remove-Item Env:NODE_OPTIONS, Env:NODE_PATH, Env:DOTNET_STARTUP_HOOKS
Add-Type -AssemblyName System.IO.Compression
function ZipFixture([string]$name,[string[]]$entries) {
  $zip=[IO.Compression.ZipFile]::Open("$Control\$name",[IO.Compression.ZipArchiveMode]::Create)
  try{foreach($entry in $entries){$null=$zip.CreateEntry($entry)}}finally{$zip.Dispose()}
  return "$Control\$name"
}
Assert-SafeArchive (ZipFixture 'safe.zip' @('bin/Runner.Listener.exe','externals/'))
foreach($name in @('../escape','bin/../../escape','C:/escape','bin/NUL.txt','bin/ads:stream','bin/trailing.')) {
  $rejected=$false
  try{Assert-SafeArchive (ZipFixture (([guid]::NewGuid().ToString())+'.zip') @($name))}catch{$rejected=$true}
  if(-not $rejected){throw "Unsafe archive accepted: $name"}
}
# Compile in an ignored fixture directory, never a runner installation.
$realPowerShell=(Get-Process -Id $PID).Path
New-ProfileFreeShim $realPowerShell
$arguments=@('spaces and "quotes"','trailing\','semi;colon','dollar$literal','')
$check="$Control\arguments.ps1"
[IO.File]::WriteAllText($check,'[IO.File]::WriteAllText($env:BYCODA_RUNNER_ARGV,($args|ConvertTo-Json -Compress)); exit 17')
$child=[Diagnostics.ProcessStartInfo]::new("$Control\shell\pwsh.exe")
$child.UseShellExecute=$false; $child.CreateNoWindow=$true
$child.Environment['BYCODA_RUNNER_ARGV']="$Control\argv.json"
foreach($arg in (@('-NoLogo','-File',$check)+$arguments)){$child.ArgumentList.Add($arg)}
$process=[Diagnostics.Process]::Start($child); $process.WaitForExit()
if($process.ExitCode -ne 17){throw 'Shim lost child exit code'}
$actual=Get-Content -Raw "$Control\argv.json"|ConvertFrom-Json
if(($actual|ConvertTo-Json -Compress) -ne ($arguments|ConvertTo-Json -Compress)){throw 'Shim changed arguments'}
Write-Output '{"pathGuards":"pass","archiveGuards":"pass","cleanChildEnvironment":"pass","compiledShimArgv":"pass","compiledShimExit":17,"provisioned":false}'
`;
    const result = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          BYCODA_RUNNER_FIXTURE: fixture,
          BYCODA_RUNNER_TEST_NODE: process.execPath,
        },
        timeout: 30_000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      pathGuards: "pass",
      archiveGuards: "pass",
      cleanChildEnvironment: "pass",
      compiledShimArgv: "pass",
      compiledShimExit: 17,
      provisioned: false,
    });
  },
);

test(
  "generated pre-job hook denies a public PR before machine steps and propagates an approved machine failure",
  { skip: process.platform !== "win32" },
  () => {
    const evidence = path.resolve("temp/verification/2026-10-28-windows-runner/setup");
    mkdirSync(evidence, { recursive: true });
    const fixture = mkdtempSync(path.join(evidence, "hook-"));
    const context = windowsContext();
    const env = {
      ...process.env,
      BYCODA_RUNNER_FIXTURE: fixture,
      BYCODA_RUNNER_TEST_NODE: process.execPath,
      BYCODA_RUNNER_EVENT: JSON.stringify(context.event),
      GITHUB_REPOSITORY: context.repository,
      GITHUB_REPOSITORY_ID: String(context.repositoryId),
      GITHUB_REF: context.ref,
      GITHUB_REF_TYPE: context.refType,
      GITHUB_WORKFLOW_REF: context.workflowRef,
      GITHUB_WORKFLOW_SHA: context.workflowSha,
      GITHUB_SHA: context.sha,
      GITHUB_RUN_ID: String(context.runId),
      GITHUB_RUN_ATTEMPT: String(context.runAttempt),
      GITHUB_JOB: context.job,
    };
    const command = String.raw`$ErrorActionPreference='Stop'
$t=$null;$e=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/setup/windows-runner.ps1'),[ref]$t,[ref]$e)
$assignment=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$hook'},$true)|Select-Object -First 1
$template=$assignment.Right.Find({param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst]},$true).Value
$fixture=$env:BYCODA_RUNNER_FIXTURE
[IO.File]::WriteAllText("$fixture\event.json",$env:BYCODA_RUNNER_EVENT)
$env:GITHUB_EVENT_PATH="$fixture\event.json"
# Only machine verification is stubbed. Actual standalone production admission
# and actual generated hook control flow execute, with explicit fixture paths.
[IO.File]::WriteAllText("$fixture\guard.ps1",'[IO.File]::WriteAllText($env:BYCODA_RUNNER_FIXTURE+"\guard-called", "yes"); exit 23')
$realShell=(Get-Process -Id $PID).Path
$trust=(Join-Path $PWD 'scripts/checks/windows-runner-trust.mjs')
$hook=$template.Replace('C:\bycoda-actions\control\node.exe',$env:BYCODA_RUNNER_TEST_NODE).Replace('C:\bycoda-actions\control\windows-runner-trust.mjs',$trust).Replace('C:\bycoda-actions\control\shell\pwsh.exe',$realShell).Replace('C:\bycoda-actions\control\windows-runner.ps1',"$fixture\guard.ps1")
[IO.File]::WriteAllText("$fixture\hook.ps1",$hook)
$env:GITHUB_EVENT_NAME='pull_request'
& $realShell -NoLogo -NoProfile -NonInteractive -File "$fixture\hook.ps1"|Out-Null
if($LASTEXITCODE -ne 1 -or (Test-Path "$fixture\guard-called")){throw 'PR bypassed protected admission'}
$env:GITHUB_EVENT_NAME='push'
& $realShell -NoLogo -NoProfile -NonInteractive -File "$fixture\hook.ps1"|Out-Null
if($LASTEXITCODE -ne 23 -or -not(Test-Path "$fixture\guard-called")){throw 'Hook skipped or masked failed machine verification'}
Write-Output '{"prDeniedBeforeMachine":true,"machineFailurePropagated":23,"fixture":true}'`;
    const result = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true, env, timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      prDeniedBeforeMachine: true,
      machineFailurePropagated: 23,
      fixture: true,
    });
  },
);
