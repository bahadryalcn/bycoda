/** Offline bootstrap contracts; no download, installer, VM creation or account mutation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  "Rust proxy inspection accepts regular same-byte hardlinks and rejects wrong hashes/ancestor junctions",
  windows,
  (t) => {
    const fixture = mkdtempSync(path.join(tmpdir(), "bycoda-guest-rust-proxy-test-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const bin = path.join(fixture, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "rustup.exe"), "harmless fixture, never executed");
    linkSync(path.join(bin, "rustup.exe"), path.join(bin, "rustc.exe"));
    symlinkSync(bin, path.join(fixture, "ancestor-junction"), "junction");
    assert.equal(
      powershell(
        String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$bin=Join-Path $env:BYCODA_TEST_TEMP 'bin'; $hash=Get-GuestSha (Join-Path $bin 'rustup.exe')
$plan=Get-GuestRustProxyPlan $bin $hash
if ($plan.needsNormalization -or @($plan.links).Count) {throw 'Regular hardlink rejected.'}
foreach ($probe in @('wrong-hash','ancestor-junction','different-regular-proxy')) {
  $rejected=$false
  try {
    if ($probe -eq 'wrong-hash') {Get-GuestRustProxyPlan $bin ('0'*64) | Out-Null}
    elseif ($probe -eq 'ancestor-junction') {Get-GuestRustProxyPlan (Join-Path $env:BYCODA_TEST_TEMP 'ancestor-junction') $hash | Out-Null}
    else {[IO.File]::WriteAllText((Join-Path $bin 'cargo.exe'),'different regular executable'); Get-GuestRustProxyPlan $bin $hash | Out-Null}
  } catch {$rejected=$true}
  if (-not $rejected) {throw 'Unsafe Rust fixture accepted.'}
}
'regular-rust-proxy-fixtures-passed'
`,
        { BYCODA_TEST_TEMP: fixture },
      ),
      "regular-rust-proxy-fixtures-passed",
    );
  },
);

test("Rust symbolic proxy Plan is read-only and never executes the proxy fixture", windows, (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), "bycoda-guest-rust-proxy-test-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const bin = path.join(fixture, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "rustup.exe"), "harmless fixture, never executed");
  try {
    symlinkSync("rustup.exe", path.join(bin, "rustc.exe"), "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip(
        "This test account cannot create Windows file symbolic links; regular hardlink/junction checks still run.",
      );
      return;
    }
    throw error;
  }
  const actual = JSON.parse(
    powershell(
      String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$CargoHome=$env:BYCODA_TEST_TEMP; $bin=Join-Path $CargoHome 'bin'; $hash=Get-GuestSha (Join-Path $bin 'rustup.exe')
$before=(Get-Item -Force -LiteralPath (Join-Path $bin 'rustc.exe')).Target
$plan=Get-GuestRustProxyPlan $bin $hash
$state=Get-GuestToolState ([pscustomobject]@{id='rust';version='1.99.1';sha256=$hash})
$after=(Get-Item -Force -LiteralPath (Join-Path $bin 'rustc.exe')).Target
if (-not $plan.needsNormalization -or @($plan.links).Count -ne 1 -or $state.compatible -or -not $state.needsNormalization) {throw 'Symbolic proxy was falsely accepted as runnable.'}
@{state=$state;targetBefore=@($before);targetAfter=@($after);strictProcessPathAllowed=(Test-GuestNoReparse (Join-Path $bin 'rustc.exe'))} | ConvertTo-Json -Depth 5
`,
      { BYCODA_TEST_TEMP: fixture },
    ),
  );
  assert.equal(actual.state.compatible, false);
  assert.equal(actual.state.needsNormalization, true);
  assert.equal(actual.strictProcessPathAllowed, false);
  assert.deepEqual(actual.targetBefore, ["rustup.exe"]);
  assert.deepEqual(actual.targetAfter, ["rustup.exe"]);
});

test(
  "Rust proxy validation rejects unknown, absolute and escaping symbolic links before normalization",
  windows,
  (t) => {
    const fixture = mkdtempSync(path.join(tmpdir(), "bycoda-guest-rust-proxy-test-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const root = path.join(fixture, "cases");
    mkdirSync(root);
    try {
      for (const name of ["unknown", "absolute", "escape"]) {
        const bin = path.join(root, name);
        mkdirSync(bin);
        writeFileSync(path.join(bin, "rustup.exe"), "same harmless bytes");
        const target =
          name === "absolute"
            ? path.join(bin, "rustup.exe")
            : name === "escape"
              ? "../outside.exe"
              : "rustup.exe";
        const proxy = name === "unknown" ? "unexpected.exe" : "rustc.exe";
        symlinkSync(target, path.join(bin, proxy), "file");
      }
    } catch (error) {
      if (error.code === "EPERM") {
        t.skip(
          "This test account cannot create Windows file symbolic links; regular hardlink/junction checks still run.",
        );
        return;
      }
      throw error;
    }
    writeFileSync(path.join(root, "outside.exe"), "same harmless bytes");
    assert.equal(
      powershell(
        String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
foreach ($name in @('unknown','absolute','escape')) {
  $bin=Join-Path $env:BYCODA_TEST_TEMP "cases\$name"; $hash=Get-GuestSha (Join-Path $bin 'rustup.exe')
  $rejected=$false; try {Get-GuestRustProxyPlan $bin $hash | Out-Null} catch {$rejected=$true}
  if (-not $rejected) {throw 'Unsafe Rust link accepted.'}
}
'unsafe-rust-links-rejected'
`,
        { BYCODA_TEST_TEMP: fixture },
      ),
      "unsafe-rust-links-rejected",
    );
  },
);

test(
  "guest ACL checks allow effective RX but reject generic write, delete-child and cache authority grants",
  windows,
  () => {
    assert.equal(
      powershell(String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$runner='S-1-5-21-1-2-3-1002'
$base='O:BAG:BAD:P(A;;FA;;;BA)(A;;FA;;;SY)'
function Check-Descriptor([string]$Extra,[bool]$Expected,[string]$AllowedRunner) {
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetSecurityDescriptorSddlForm($base+$Extra)
  $allowed=$true; try {Assert-GuestAcl $acl $AllowedRunner} catch {$allowed=$false}
  if ($allowed -ne $Expected) {throw "Incorrect effective ACL decision: $Extra"}
}
# Protected control remains readable by the runner; read bits are not mutation.
Check-Descriptor "(A;;0x1200a9;;;$runner)" $true
Check-Descriptor "(A;;GRGX;;;$runner)" $true
Check-Descriptor '(A;;GR;;;WD)' $true
Check-Descriptor '(A;OICIIO;GA;;;CO)' $true
# Actual mutation bits and generic write/all must not disappear in enum mapping.
foreach ($rights in @('GW','GA','0x2','0x4','0x10','0x100','0x40','0x10000','0x40000','0x80000')) {
  Check-Descriptor "(A;;$rights;;;WD)" $false
}
# Only this policy-bound runner may write its cache; no cache DACL/owner authority.
Check-Descriptor "(A;;GW;;;$runner)" $false
Check-Descriptor "(A;;GW;;;$runner)" $true $runner
Check-Descriptor "(A;;0x1301bf;;;$runner)" $true $runner
Check-Descriptor '(A;;GW;;;S-1-5-21-1-2-3-9999)' $false $runner
Check-Descriptor "(A;;0x40000;;;$runner)" $false $runner
Check-Descriptor "(A;;0x80000;;;$runner)" $false $runner
Check-Descriptor "(A;;GA;;;$runner)" $false $runner
$unowned=[Security.AccessControl.DirectorySecurity]::new()
$unowned.SetSecurityDescriptorSddlForm('O:WDG:BAD:P(A;;FR;;;WD)')
$rejected=$false; try {Assert-GuestAcl $unowned} catch {$rejected=$true}
if (-not $rejected) {throw 'Untrusted owner accepted.'}
'guest-acl-fixtures-passed'
`),
      "guest-acl-fixtures-passed",
    );
  },
);

test(
  "Rust seed identity compares unique exact paths, bytes and hashes independently of serialization order",
  windows,
  () => {
    assert.equal(
      powershell(String.raw`
$ErrorActionPreference='Stop'
. $env:BYCODA_TEST_GUEST_HELPER
$recorded=@(
  [pscustomobject]@{path='cargo/bin/cargo.exe';bytes=[long]10;sha256=('a'*64)},
  [pscustomobject]@{path='cargo/bin/cargo-clippy.exe';bytes=[int]20;sha256=('b'*64)},
  [pscustomobject]@{path='rustup/settings.toml';bytes=[long]0;sha256=('c'*64)}
)
# Reverse the rows and reorder descriptor keys, as independently serialized receipts may.
$permuted=@(
  [pscustomobject][ordered]@{sha256=('c'*64);bytes=[int]0;path='rustup/settings.toml'},
  [pscustomobject][ordered]@{bytes=[long]20;path='cargo/bin/cargo-clippy.exe';sha256=('b'*64)},
  [pscustomobject][ordered]@{sha256=('a'*64);path='cargo/bin/cargo.exe';bytes=[int]10}
)
Assert-GuestInventorySame $recorded $recorded
Assert-GuestInventorySame $permuted $recorded
foreach ($mutation in @('duplicate-current','duplicate-recorded','bytes','hash','missing','additional','case','malformed','empty','oversized')) {
  $current=$recorded | ConvertTo-Json -Depth 5 | ConvertFrom-Json
  $expected=$recorded | ConvertTo-Json -Depth 5 | ConvertFrom-Json
  switch ($mutation) {
    'duplicate-current' {$current += $current[0]}
    'duplicate-recorded' {$expected += $expected[0]}
    'bytes' {$current[0].bytes=11}
    'hash' {$current[0].sha256='d'*64}
    'missing' {$current=$current[0..1]}
    'additional' {$current += [pscustomobject]@{path='cargo/bin/extra.exe';bytes=1;sha256=('a'*64)}}
    'case' {$current[0].path='cargo/bin/CARGO.exe'}
    'malformed' {$current[0].path='cargo/../outside'}
    'empty' {$current=@();$expected=@()}
    'oversized' {$current=New-Object object[] 50001}
  }
  $rejected=$false; try {Assert-GuestInventorySame $current $expected} catch {$rejected=$true}
  if (-not $rejected) {throw "Changed/invalid inventory accepted: $mutation"}
}
'semantic-rust-inventory-fixtures-passed'
`),
      "semantic-rust-inventory-fixtures-passed",
    );
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
