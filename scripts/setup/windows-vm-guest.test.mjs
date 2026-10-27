/** Offline bootstrap contracts; no download, installer, VM creation or account mutation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./windows-vm-guest.ps1", import.meta.url));
const legacy = path.join(
  process.env.WINDIR ?? "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const windows = { skip: process.platform !== "win32" };
function powershell(script, env = {}) {
  const result = spawnSync(
    legacy,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: {
        ...process.env,
        PSModulePath: path.join(
          process.env.WINDIR ?? "C:\\Windows",
          "System32/WindowsPowerShell/v1.0/Modules",
        ),
        BYCODA_TEST_GUEST_HELPER: helper,
        ...env,
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("guest bootstrap has no force, profile, root, credential or host-install override", () => {
  const source = readFileSync(helper, "utf8");
  assert.match(source, /#Requires -Version 5\.1/);
  assert.match(source, /ValidateSet\('Plan', 'Install', 'SeedRunnerCache'\)/);
  assert(!/\$(?:Force|SkipGuard|Password|Credential|RootOverride)\b/.test(source));
  assert(
    !/Restart-Computer|shutdown\.exe|Register-ScheduledTask|New-LocalUser|Set-LocalUser|Invoke-Expression|Start-Service/.test(
      source,
    ),
  );
  assert.match(source, /WindowStyle = 'Hidden'/);
  assert.match(source, /CreateNoWindow = \$true/);
});

test("initial Windows PowerShell 5.1 parses the real helper and Plan is read-only", windows, () => {
  const output = powershell(String.raw`
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($env:BYCODA_TEST_GUEST_HELPER,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
& $env:BYCODA_TEST_GUEST_HELPER -Mode Plan
`);
  const plan = JSON.parse(output);
  assert.equal(plan.readOnly, true);
  assert.equal(plan.allowedInstall, false);
  assert(plan.denials.includes("exact-new-vm-uuid-required"));
  assert.equal(plan.runnerRegistration, false);
  assert.equal(plan.automaticRestart, false);
  assert.equal(plan.toolManifest.length, 8);
  assert.equal(plan.toolManifest.find((tool) => tool.id === "node").version, "24.22.1");
  assert.equal(plan.toolManifest.find((tool) => tool.id === "pnpm").version, "12.15.0");
  assert(plan.toolManifest.every((tool) => /^[a-f0-9]{64}$/.test(tool.sha256)));
});

test(
  "VM UUID, real Hyper-V facts, elevation and dedicated local identity all independently gate writes",
  windows,
  () => {
    assert.equal(
      powershell(String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$expected='a5d869cf-d1a0-490a-a8ed-7c80f8afc333'
$base=@{manufacturer='Microsoft Corporation';model='Virtual Machine';biosManufacturer='Microsoft Corporation';hyperVIntegration=$true;vmUuid=$expected;computerName='BYCODA-CI';identity='BYCODA-CI\BycodaAdmin';sid='S-1-5-21-1-2-3-1001';profile='C:\Users\BycodaAdmin';elevated=$true;os64=$true;process64=$true}
if (@(Get-GuestDenials ([pscustomobject]$base) $expected).Count) { throw 'Valid offline fixture unexpectedly rejected.' }
$mutations=@(@{manufacturer='ASUSTeK COMPUTER INC.'},@{model='Physical PC'},@{biosManufacturer='Other'},@{hyperVIntegration=$false},@{vmUuid='00000000-0000-0000-0000-000000000000'},@{vmUuid='b5d869cf-d1a0-490a-a8ed-7c80f8afc333'},@{identity='BYCODA-CI\kraba'},@{identity='DOMAIN\BycodaAdmin'},@{profile='C:\Users\kraba'},@{profile='C:\Users\BycodaAdmin.other'},@{sid='S-1-5-18'},@{elevated=$false},@{os64=$false},@{process64=$false})
foreach ($mutation in $mutations) {
  $facts=$base.Clone(); foreach ($key in $mutation.Keys) {$facts[$key]=$mutation[$key]}
  if (@(Get-GuestDenials ([pscustomobject]$facts) $expected).Count -eq 0) { throw 'Invalid fixture gained admission.' }
}
if (@(Get-GuestDenials ([pscustomobject]$base) '').Count -eq 0) { throw 'Missing expected VM accepted.' }
if (@(Get-GuestDenials ([pscustomobject]$base) 'invalid').Count -eq 0) { throw 'Malformed expected VM accepted.' }
'guard-fixtures-passed'
`),
      "guard-fixtures-passed",
    );
  },
);

test(
  "manifest validation rejects unsigned metadata substitutions and incomplete/unbounded sources",
  windows,
  () => {
    assert.equal(
      powershell(String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
function Copy-Manifest { return @(Get-GuestToolManifest | ConvertTo-Json -Depth 6 | ConvertFrom-Json) }
Assert-GuestManifest (Get-GuestToolManifest)
foreach ($mutation in @('hash','http','foreign','filename','version','size','duplicate','missing')) {
  $items=Copy-Manifest
  switch ($mutation) {
    'hash' {$items[0].sha256='not-a-hash'}
    'http' {$items[0].url=$items[0].url.Replace('https:','http:')}
    'foreign' {$items[0].url='https://example.invalid/node-v24.22.1-x64.msi'}
    'filename' {$items[0].filename='other.msi'}
    'version' {$items[0].version='latest'}
    'size' {$items[0].maxBytes=2147483647}
    'duplicate' {$items += $items[0]}
    'missing' {$items=$items[0..6]}
  }
  $rejected=$false; try { Assert-GuestManifest $items } catch {$rejected=$true}
  if (-not $rejected) {throw "Unsafe manifest accepted: $mutation"}
}
'manifest-fixtures-passed'
`),
      "manifest-fixtures-passed",
    );
  },
);

test(
  "artifact validation hashes real temporary bytes and rejects tampering, unsigned Microsoft payloads and junctions",
  windows,
  (t) => {
    const temporary = mkdtempSync(path.join(tmpdir(), "bycoda-guest-tool-test-"));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    assert.equal(
      powershell(
        String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$file=Join-Path $env:BYCODA_TEST_TEMP 'fixture.exe'
[IO.File]::WriteAllText($file,'offline harmless fixture')
$tool=[pscustomobject]@{sha256=Get-GuestSha $file;maxBytes=1048576;microsoftSignature=$false}
Test-GuestArtifact $tool $file
[IO.File]::WriteAllText($file,'tampered')
$rejected=$false; try {Test-GuestArtifact $tool $file} catch {$rejected=$true}
if (-not $rejected) {throw 'Tampered payload accepted.'}
$tool.sha256=Get-GuestSha $file; $tool.microsoftSignature=$true
$rejected=$false; try {Test-GuestArtifact $tool $file} catch {$rejected=$true}
if (-not $rejected) {throw 'Unsigned Microsoft payload accepted.'}
$actual=Join-Path $env:BYCODA_TEST_TEMP 'actual'; $link=Join-Path $env:BYCODA_TEST_TEMP 'junction'
New-Item -ItemType Directory -Path $actual | Out-Null
New-Item -ItemType Junction -Path $link -Target $actual | Out-Null
if (Test-GuestNoReparse $link) {throw 'Junction accepted.'}
foreach ($unsafe in @('C:relative','relative','\\server\share','C:\file:stream')) {if (Test-GuestNoReparse $unsafe) {throw 'Unsafe path accepted.'}}
'artifact-fixtures-passed'
`,
        { BYCODA_TEST_TEMP: temporary },
      ),
      "artifact-fixtures-passed",
    );
  },
);

test(
  "MSI uses bare quiet/logging switches and NAME=quoted-value syntax, independent of CRT argv",
  windows,
  () => {
    const actual = JSON.parse(
      powershell(String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$package='C:\ProgramData\BycodaCI-GuestBootstrap\newroot\runs\fixture\node-v24.22.1-x64.msi'
$log='C:\ProgramData\BycodaCI-GuestBootstrap\newroot\runs\fixture\node-msi.log'
$node=@('/i',$package,'/qn','/norestart','INSTALLDIR=C:\Program Files\nodejs','/L*v',$log)
$ps=@('/i','C:\owned fixture\PowerShell-7.6.9-win-x64.msi','/qn','/norestart','ADD_PATH=1','ENABLE_PSREMOTING=0','USE_MU=0','ENABLE_MU=0','/L*v','C:\owned fixture\powershell-msi.log')
$nodeLine=Get-GuestProcessCommandLine "$env:WINDIR\System32\msiexec.exe" $node
$psLine=Get-GuestMsiCommandLine $ps
foreach ($invalid in @(
  @('/i',$package,'/qb','/norestart','/L*v',$log),
  @('/i',$package,'/qn','/forcerestart','/L*v',$log),
  @('/i',$package,'/qn','/norestart'),
  @('/i',$package,'/qn','/norestart','/L*v',$log,'CUSTOM=arbitrary'),
  @('/i',$package,'/qn','/norestart','/L*v',$log,'INSTALLDIR=C:\Users\kraba'),
  @('/i',$package,'/qn','/norestart','/L*v',$log,'/qn'),
  @('/i','C:\bad"name.msi','/qn','/norestart','/L*v',$log)
)) {
  $rejected=$false; try {Get-GuestMsiCommandLine $invalid | Out-Null} catch {$rejected=$true}
  if (-not $rejected) {throw 'Unsafe MSI grammar accepted.'}
}
@{node=$nodeLine;powershell=$psLine} | ConvertTo-Json
`),
    );
    assert.equal(
      actual.node,
      '/i "C:\\ProgramData\\BycodaCI-GuestBootstrap\\newroot\\runs\\fixture\\node-v24.22.1-x64.msi" /qn /norestart INSTALLDIR="C:\\Program Files\\nodejs" /L*v "C:\\ProgramData\\BycodaCI-GuestBootstrap\\newroot\\runs\\fixture\\node-msi.log"',
    );
    assert.equal(
      actual.powershell,
      '/i "C:\\owned fixture\\PowerShell-7.6.9-win-x64.msi" /qn /norestart ADD_PATH="1" ENABLE_PSREMOTING="0" USE_MU="0" ENABLE_MU="0" /L*v "C:\\owned fixture\\powershell-msi.log"',
    );
    for (const raw of [actual.node, actual.powershell]) {
      assert(!raw.includes('"/qn"'));
      assert(!raw.includes('"/i"'));
      assert(!raw.includes('"INSTALLDIR='));
    }
  },
);

test(
  "hidden process invocation preserves literal Windows arguments without invoking a shell",
  windows,
  () => {
    const observed = JSON.parse(
      powershell(
        String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$result=Invoke-GuestProcess $env:BYCODA_TEST_NODE @('-e','console.log(JSON.stringify(process.argv.slice(1)))','--','with space','quote"inside','C:\ends\')
if ($result.exitCode -ne 0) {throw $result.stderr}
$result.stdout
`,
        { BYCODA_TEST_NODE: realpathSync(process.execPath) },
      ),
    );
    assert.deepEqual(observed, ["with space", 'quote"inside', "C:\\ends\\"]);
  },
);

test(
  "real Install and SeedRunnerCache reject missing VM identity before host writes/network",
  windows,
  () => {
    const bootstrap = "C:\\ProgramData\\BycodaCI-GuestBootstrap";
    const before = existsSync(bootstrap);
    for (const mode of ["Install", "SeedRunnerCache"]) {
      const result = spawnSync(
        legacy,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper, "-Mode", mode],
        {
          env: { ...process.env, BYCODA_GUEST_VM: "true", BYCODA_GUEST_ADMIN: "true" },
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Guest bootstrap denied before writes\/network/);
    }
    assert.equal(existsSync(bootstrap), before);
  },
);
