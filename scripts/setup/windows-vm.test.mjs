import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import test from "node:test";
const windows = process.platform === "win32";
const script = path.resolve("scripts/setup/windows-vm.ps1");
const powershell = windows
  ? path.join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    )
  : "powershell";
const hash = "bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38";
function metadata() {
  return {
    elevated: true,
    hyperVAvailable: true,
    vmQuerySucceeded: true,
    vmExists: false,
    switchExists: true,
    availableMemoryBytes: 18 * 1024 ** 3,
    logicalProcessors: 16,
    driveType: "Fixed",
    driveFreeBytes: 200 * 1024 ** 3,
    ownedRootExists: false,
    ownedRootOwned: false,
    vmRootExists: false,
    controllerRootExists: false,
    controllerRootOwned: false,
    credentialExists: false,
    isoExists: true,
    isoHash: hash,
    reparsePaths: [],
  };
}
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-vm-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "metadata.json");
  writeFileSync(file, JSON.stringify(metadata()));
  return { root, file };
}
function run(args) {
  return spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
}
function command(source) {
  return spawnSync(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(source, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
}
function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
test(
  "VM script parses under Windows PowerShell 5.1 without executing provisioning",
  { skip: !windows },
  () => {
    const result = command(
      `$tokens=$null; $parseErrors=$null; [void][Management.Automation.Language.Parser]::ParseFile(${quote(script)},[ref]$tokens,[ref]$parseErrors); if ($parseErrors.Count) { throw 'PowerShell parse failed' }; 'parsed'`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /parsed/);
  },
);
test(
  "readonly fixture Plan binds fixed owned paths/resources and cannot claim live readiness",
  { skip: !windows },
  (t) => {
    const { root, file } = fixture(t),
      secretFile = path.join(root, "synthetic-password.txt"),
      synthetic = "Fixture-only-do-not-use!A1";
    writeFileSync(secretFile, synthetic);
    const before = readdirSync(root).sort();
    const result = run(["-Mode", "Plan", "-MetadataFile", file, "-AdminPasswordFile", secretFile]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.simulation, true);
    assert.equal(plan.canCreate, false);
    assert.equal(plan.snapshotReady, true);
    assert.equal(plan.vmName, "bycoda-windows-ci");
    assert.equal(plan.paths.root.toLowerCase(), "g:\\bycodaci\\vms\\bycoda-windows-ci");
    assert.equal(plan.resources.generation, 2);
    assert.equal(plan.resources.processors, 8);
    assert.equal(plan.resources.dynamicVhdBytes, 160 * 1024 ** 3);
    assert.equal(plan.resources.startupMemoryBytes, 8 * 1024 ** 3);
    assert.equal(plan.resources.minimumMemoryBytes, 4 * 1024 ** 3);
    assert.equal(plan.resources.maximumMemoryBytes, 12 * 1024 ** 3);
    assert(!result.stdout.includes(synthetic));
    assert(!result.stdout.includes("<unattend"));
    assert.equal(readFileSync(secretFile, "utf8"), synthetic);
    assert.deepEqual(readdirSync(root).sort(), before);
  },
);
test(
  "Plan refuses path escape, wrong identity, UNC and guarded reparse ancestors",
  { skip: !windows },
  (t) => {
    const { file } = fixture(t);
    for (const args of [
      ["-VmName", "personal"],
      ["-VmRoot", "G:/BycodaCI/VMs/other"],
      ["-VmRoot", "C:/BycodaCI/VMs/bycoda-windows-ci"],
      ["-VmRoot", "G:/BycodaCI/VMs/../VMs/bycoda-windows-ci"],
      ["-VmRoot", "//server/share/bycoda-windows-ci"],
      ["-IsoPath", "G:/BycodaCI/media.iso"],
    ])
      assert.notEqual(
        run(["-Mode", "Plan", "-MetadataFile", file, ...args]).status,
        0,
        JSON.stringify(args),
      );
    for (const reparsePaths of [
      ["G:/BycodaCI"],
      ["C:/ProgramData/BycodaCIController"],
      [path.join(process.env.USERPROFILE ?? homedir(), ".bycoda-ci")],
    ]) {
      writeFileSync(file, JSON.stringify({ ...metadata(), reparsePaths }));
      assert.notEqual(run(["-Mode", "Plan", "-MetadataFile", file]).status, 0);
    }
  },
);
test(
  "unknown VM state, existing resources, wrong media and host pressure block readiness",
  { skip: !windows },
  (t) => {
    const { file } = fixture(t);
    for (const change of [
      { vmQuerySucceeded: false },
      { vmExists: null },
      { vmExists: true },
      { vmRootExists: true },
      { switchExists: false },
      { isoHash: "0".repeat(64) },
      { isoExists: false },
      { driveType: "Network" },
      { driveFreeBytes: 1 },
      { availableMemoryBytes: 8 * 1024 ** 3 },
      { logicalProcessors: 4 },
      { credentialExists: true },
      { ownedRootExists: true },
      { controllerRootExists: true },
    ]) {
      writeFileSync(file, JSON.stringify({ ...metadata(), ...change }));
      const result = run(["-Mode", "Plan", "-MetadataFile", file]);
      assert.equal(result.status, 0, result.stderr);
      const plan = JSON.parse(result.stdout);
      assert.equal(plan.snapshotReady, false, JSON.stringify(change));
      assert.equal(plan.canCreate, false);
      assert(plan.reasons.length > 0);
    }
  },
);
test(
  "Create rejects fixture metadata before any elevation or VM mutation path",
  { skip: !windows },
  (t) => {
    const { root, file } = fixture(t),
      before = readdirSync(root).sort();
    const result = run(["-Mode", "Create", "-MetadataFile", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Metadata fixtures are allowed only for readonly Plan/);
    assert.deepEqual(readdirSync(root).sort(), before);
  },
);
test(
  "real junction fixture cannot substitute metadata behind the path guard",
  { skip: !windows },
  (t) => {
    const { root, file } = fixture(t),
      target = path.join(root, "target"),
      junction = path.join(root, "junction");
    mkdirSync(target);
    writeFileSync(path.join(target, "metadata.json"), readFileSync(file));
    symlinkSync(target, junction, "junction");
    const result = run(["-Mode", "Plan", "-MetadataFile", path.join(junction, "metadata.json")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reparse-point ancestor/);
  },
);
test(
  "supported unattend XML escapes fixture credentials and avoids account/activation bypasses",
  { skip: !windows },
  () => {
    const synthetic = "Fixture-only<&\"'!Password9";
    const result = command(
      `. ${quote(script)}; $fixture=${quote(synthetic)}; [xml]$doc=New-VmUnattendXml $fixture; $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable); $ns.AddNamespace('u','urn:schemas-microsoft-com:unattend'); $account=$doc.SelectSingleNode('//u:LocalAccount',$ns); if ($account.Name -ne 'BycodaAdmin' -or $account.Password.Value -cne $fixture -or $account.Group -ne 'Administrators') { throw 'Fixture account XML mismatch' }; if ($doc.SelectNodes('//u:SkipMachineOOBE|//u:SkipUserOOBE|//u:AutoLogon|//u:ProductKey',$ns).Count) { throw 'Unsupported bypass/persistent logon setting' }; if ($doc.SelectSingleNode('//u:ProtectYourPC',$ns).InnerText -ne '1') { throw 'Recommended guest updates were not retained' }; @{account='BycodaAdmin';passwordRetained=$true;unsupportedBypass=$false} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.passwordRetained, true);
    assert.equal(proof.unsupportedBypass, false);
    assert(!result.stdout.includes(synthetic));
    assert(!result.stdout.includes("<unattend"));
  },
);
test(
  "private actor-owned input ACL is accepted while broad readers and output ACL relaxation are refused",
  { skip: !windows },
  (t) => {
    const { root } = fixture(t),
      input = path.join(root, "synthetic-acl-input.txt");
    writeFileSync(input, "fixture only");
    const result = command(
      `. ${quote(script)}; $file=${quote(input)}; $actor=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[Security.AccessControl.FileSecurity]::new(); $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($actor); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($actor,'FullControl','Allow')); Set-Acl -LiteralPath $file -AclObject $acl; Assert-VmPasswordInputAcl $file; $outputRefused=$false; try { Assert-VmProtectedAcl $file } catch { $outputRefused=$true }; if (-not $outputRefused) { throw 'Output ACL was weakened' }; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow')); $broadRefused=$false; try { Assert-VmPasswordAccessDescriptor $acl $actor.Value } catch { $broadRefused=$true }; if (-not $broadRefused) { throw 'Broad input access was accepted' }; @{privateInputAccepted=$true;broadInputRefused=$broadRefused;strictOutputRetained=$outputRefused} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).strictOutputRetained, true);
  },
);
test(
  "Windows PowerShell 5.1 atomically replaces existing journal JSON without a backup path",
  { skip: !windows },
  (t) => {
    const { root } = fixture(t),
      journal = path.join(root, "journal.json");
    const result = command(
      `. ${quote(script)}; $path=${quote(journal)}; Write-VmJson $path @{stage='credential';version=1} -NewOnly; Write-VmJson $path @{stage='mount-iso';version=2;nested=@{verified=$true}}; $updated=Read-VmJson $path; if ($updated.stage -ne 'mount-iso' -or $updated.version -ne 2 -or -not $updated.nested.verified) { throw 'Atomic replacement lost journal data' }; $refused=$false; try { Write-VmJson $path @{stage='wrong'} -NewOnly } catch { $refused=$true }; if (-not $refused) { throw 'NewOnly overwrote an existing journal' }; @{atomicReplacement=$true;newOnlyRefused=$refused;temporaryFiles=@(Get-ChildItem -LiteralPath ${quote(root)} -Filter '*.tmp').Count} | ConvertTo-Json -Compress`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      atomicReplacement: true,
      newOnlyRefused: true,
      temporaryFiles: 0,
    });
    const bytes = readFileSync(journal);
    assert.notEqual(bytes[0], 0xef);
    assert.equal(JSON.parse(bytes.toString("utf8")).stage, "mount-iso");
  },
);
