import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test(
  "compiled shim forwards live Unicode output/error, stdin and exit without waiting for open upstream stdin",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = path.resolve("temp/verification/2026-10-28-windows-runner/setup");
    mkdirSync(root, { recursive: true });
    const fixture = mkdtempSync(path.join(root, "shim-output-"));
    mkdirSync(path.join(fixture, "shell"));
    const compile = String.raw`$ErrorActionPreference='Stop'
$t=$null;$e=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/setup/windows-runner.ps1'),[ref]$t,[ref]$e)
if($e.Count){throw 'Runner source parse failed'}
foreach($name in @('Invoke-CleanTool','New-ProfileFreeShim')) {
  $helper=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)|Select-Object -First 1
  Invoke-Expression $helper.Extent.Text
}
$Control=$env:BYCODA_SHIM_OUTPUT_FIXTURE
$WindowsRoot=[Environment]::GetFolderPath('Windows')
$target=(Get-Process -Id $PID).Path
New-ProfileFreeShim $target
[Console]::Write($target)`;
    const built = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", compile],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, BYCODA_SHIM_OUTPUT_FIXTURE: fixture },
      },
    );
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const target = built.stdout.trim();
    const shim = path.join(fixture, "shell/pwsh.exe");
    const script = path.join(fixture, "streams.ps1");
    writeFileSync(
      script,
      `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if([Environment]::GetCommandLineArgs() -notcontains '-NoProfile'){exit 91}
$incoming=[Console]::In.ReadToEnd()
[Console]::Out.Write('out:éλ漢🌍|'+$incoming+('λ'*65536))
[Console]::Error.Write('err:ş漢🌍|'+('漢'*65536))
exit 37
`,
    );
    const incoming = "stdin:öλ漢🌍\n";
    const result = spawnSync(shim, ["-File", script], {
      input: Buffer.from(incoming),
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.status, 37, result.stderr?.toString());
    assert.deepEqual(result.stdout, Buffer.from(`out:éλ漢🌍|${incoming}${"λ".repeat(65536)}`));
    assert.deepEqual(result.stderr, Buffer.from(`err:ş漢🌍|${"漢".repeat(65536)}`));

    const runOpenInput = (args, onData = () => {}) =>
      new Promise((resolve, reject) => {
        const child = spawn(shim, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Owned shim fixture timed out with upstream stdin still open"));
        }, 10_000);
        const stdout = [],
          stderr = [];
        child.stdout.on("data", (data) => {
          stdout.push(data);
          onData(data, child);
        });
        child.stderr.on("data", (data) => stderr.push(data));
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          child.stdin.destroy();
          resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
        });
        // Deliberately never close stdin: a child that does not read it must still exit.
      });
    const open = await runOpenInput(["-Command", "[Console]::Write('done'); exit 29"]);
    assert.equal(open.code, 29);
    assert.equal(open.stdout.toString(), "done");
    let streamedBeforeExit = false;
    const live = await runOpenInput(
      [
        "-Command",
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Out.Write('ready:漢🌍'); [Console]::Out.Flush(); [Threading.Thread]::Sleep(700); [Console]::Error.Write('late:é'); exit 31",
      ],
      (_data, child) => {
        streamedBeforeExit ||= child.exitCode === null;
      },
    );
    assert.equal(live.code, 31);
    assert.equal(live.stdout.toString(), "ready:漢🌍");
    assert.equal(live.stderr.toString(), "late:é");
    assert.equal(streamedBeforeExit, true, "stdout must reach the caller before child exit");

    // Windows known-folder profile locations may ignore USERPROFILE/HOME overrides.
    // Install a sentinel only when the actual derived path is inside this fixture.
    const profileEnv = { ...process.env, USERPROFILE: fixture, HOME: fixture };
    const probe = spawnSync(
      target,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::Write($PROFILE.CurrentUserAllHosts)",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000, env: profileEnv },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const profile = path.resolve(probe.stdout.trim());
    if (profile.toLowerCase().startsWith(fixture.toLowerCase() + path.sep)) {
      const sentinel = path.join(fixture, "profile-executed");
      mkdirSync(path.dirname(profile), { recursive: true });
      writeFileSync(
        profile,
        `[IO.File]::WriteAllText('${sentinel.replaceAll("'", "''")}', 'unexpected')`,
      );
      const guarded = spawnSync(shim, ["-Command", "exit 43"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
        env: profileEnv,
      });
      assert.equal(guarded.status, 43, guarded.stderr);
      assert.equal(existsSync(sentinel), false);
    } else {
      t.diagnostic(
        "NoProfile argv verified; profile sentinel not installed because Windows resolves it outside the isolated fixture.",
      );
    }
  },
);

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
