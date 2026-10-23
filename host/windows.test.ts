import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { providerLaunch } from "./process";
import {
  powershell,
  powershellArgs,
  powershellEnvironment,
  powershellErrorText,
  psQuote,
  protectWindowsDirectory,
  runPowerShell,
  windowsTaskScript,
  windowsServiceRunner,
  windowsNodeSetupScript,
  windowsUninstallScript,
  windowsUninstallPreflightScript,
} from "./windows";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temporary = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-win-test-"));
  directories.push(dir);
  return dir;
};

it.skipIf(process.platform !== "win32")(
  "checks effective task deletion rights without changing permissions or stopping the host",
  async () => {
    // Exercise the actual Windows access check, including denied rights, rather
    // than assuming that membership in Administrators grants an unelevated token access.
    const script = windowsUninstallPreflightScript();
    const definitions = script.slice(0, script.lastIndexOf("\nAssert-BycodaTaskRemovalAccess"));
    const result = JSON.parse(
      await runPowerShell(`
${definitions}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$descriptor = 'O:' + $sid + 'G:' + $sid + 'D:'
Assert-BycodaTaskRemovalAccess ('Bycoda Missing Test-' + [Guid]::NewGuid().ToString('N'))
@{
  readOnly = [BycodaTaskAccess]::CanDelete($descriptor + '(A;;FR;;;' + $sid + ')')
  full = [BycodaTaskAccess]::CanDelete($descriptor + '(A;;FA;;;' + $sid + ')')
  denied = [BycodaTaskAccess]::CanDelete($descriptor + '(D;;SD;;;' + $sid + ')(A;;FA;;;' + $sid + ')')
} | ConvertTo-Json -Compress
`),
    );
    expect(result).toEqual({ readOnly: false, full: true, denied: false });
  },
);

it.skipIf(process.platform !== "win32")(
  "reuses the firewall executable across releases, replaces Node atomically and restores older engines",
  async () => {
    const directory = temporary();
    const first = join(directory, "first-node.exe");
    const second = join(directory, "second-node.exe");
    const stable = join(directory, "engine", "node.exe");
    writeFileSync(first, "engine one");
    writeFileSync(second, "engine two");
    await runPowerShell(windowsNodeSetupScript(first, directory));
    // Identical Node bytes must be reusable even while a process locks the file.
    const result = await runPowerShell(`
$lock = [IO.File]::Open(${psQuote(stable)}, 'Open', 'Read', 'Read')
try {
  ${windowsNodeSetupScript(first, directory)}
  try {
    ${windowsNodeSetupScript(second, directory)}
    throw 'Unexpected engine replacement'
  } catch {
    if ($_.Exception.Message -eq 'Unexpected engine replacement') { throw }
  }
  [IO.File]::ReadAllText(${psQuote(stable)})
} finally { $lock.Dispose() }
`);
    expect(result.trim()).toBe("engine one");
    await runPowerShell(windowsNodeSetupScript(second, directory));
    expect(readFileSync(stable, "utf8")).toBe("engine two");
    await runPowerShell(windowsNodeSetupScript(first, directory));
    expect(readFileSync(stable, "utf8")).toBe("engine one");
  },
);

it.skipIf(process.platform !== "win32").each([0, 23])(
  "keeps a host alive after stderr diagnostics and preserves exit code %s",
  (exitCode) => {
    const directory = temporary();
    const entry = join(directory, "diagnostic-host.cjs");
    const runner = join(directory, "service.ps1");
    writeFileSync(
      entry,
      `process.stderr.write('provider diagnostic\\n');
setTimeout(() => { console.log('host still running'); process.exitCode = ${exitCode}; }, 200);`,
    );
    writeFileSync(
      runner,
      windowsServiceRunner(
        {
          directory,
          entry,
          executable: process.execPath,
          port: 3776,
        },
        process.env.PATH ?? "",
      ),
    );
    let status: number | null | undefined;
    try {
      execFileSync(powershell(), powershellArgs(`& ${psQuote(runner)}; exit $LASTEXITCODE`), {
        windowsHide: true,
        timeout: 15_000,
        env: powershellEnvironment(),
        stdio: "pipe",
      });
      status = 0;
    } catch (error) {
      status = (error as { status?: number | null }).status;
    }
    const bytes = readFileSync(join(directory, "host.log"));
    const log = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8");
    expect(log).toContain("provider diagnostic");
    expect(log).toContain("host still running");
    expect(status).toBe(exitCode);
  },
);

it.skipIf(process.platform !== "win32")("reports a missing host executable as failure", () => {
  const directory = temporary();
  const runner = join(directory, "service.ps1");
  writeFileSync(
    runner,
    windowsServiceRunner(
      {
        directory,
        entry: join(directory, "host.mjs"),
        executable: join(directory, "missing.exe"),
        port: 3776,
      },
      process.env.PATH ?? "",
    ),
  );
  expect(() =>
    execFileSync(powershell(), powershellArgs(`& ${psQuote(runner)}; exit $LASTEXITCODE`), {
      windowsHide: true,
      timeout: 15_000,
      env: powershellEnvironment(),
      stdio: "pipe",
    }),
  ).toThrow();
});

it("runs npm provider entry points directly with literal arguments and bundled Node", async () => {
  const directory = temporary();
  const entry = join(directory, "node_modules/@openai/codex/bin/codex.js");
  mkdirSync(join(directory, "node_modules/@openai/codex/bin"), {
    recursive: true,
  });
  writeFileSync(entry, "console.log(JSON.stringify(process.argv.slice(2)))");
  const args = [
    "path with spaces",
    "a&b",
    "a|b",
    "%USERPROFILE%",
    "$(whoami)",
    'a"b',
    "line\nbreak",
  ];
  const launch = await providerLaunch(join(directory, "codex.cmd"), args, "win32");
  expect(launch.command).toBe(process.execPath);
  expect(JSON.parse(execFileSync(launch.command, launch.args, { encoding: "utf8" }))).toEqual(args);
  await expect(providerLaunch(join(directory, "unknown.cmd"), args, "win32")).rejects.toThrow(
    "Unsupported",
  );
});

it("uses an unlimited, unelevated per-user task and preserves literal paths", () => {
  const options = {
    directory: "C:\\Users\\Nick's $PC\\.bycoda-host",
    executable: "C:\\Runtime\\node.exe",
    entry: "C:\\Runtime\\host.mjs",
    port: 3774,
  };
  const script = windowsTaskScript(options, "C:\\bin;C:\\User's tools");
  expect(script).toContain("-LogonType Interactive -RunLevel Limited");
  expect(script).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
  expect(script).toContain("-MultipleInstances IgnoreNew");
  expect(script).toContain("-OutputType WindowsApplication");
  expect(script).toContain("service-launcher-v3.exe");
  expect(script).toContain("Set-ScheduledTask -TaskName $name -Action $action");
  expect(script).not.toMatch(/Stop-ScheduledTask|Unregister-ScheduledTask|S4U|RunLevel Highest/);
  expect(psQuote("Nick's $PC")).toBe("'Nick''s $PC'");
  expect(Buffer.from(powershellArgs("$x = '日本語'").at(-1)!, "base64").toString("utf16le")).toBe(
    "$x = '日本語'",
  );
});

it("keeps only the text of a PowerShell error written as CLIXML", () => {
  const privilege =
    "The process does not possess the 'SeSecurityPrivilege' privilege which is required for this operation.";
  expect(
    powershellErrorText(
      `#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>${privilege}\r\n`,
    ),
  ).toBe(privilege);
  expect(powershellErrorText("Access denied.\r\n")).toBe("Access denied.");
});

it.skipIf(process.platform !== "win32")(
  "keeps stderr diagnostics harmless across successive service runtime upgrades",
  async () => {
    const directory = temporary();
    // Task Scheduler is isolated; exercise the generated runner with real Windows PowerShell.
    writeFileSync(join(directory, "service-launcher-v3.exe"), "unused test launcher");
    for (const version of ["0.6.35", "0.6.36"]) {
      const runtime = join(directory, "runtime", version);
      mkdirSync(runtime, { recursive: true });
      const entry = join(runtime, "host.cjs");
      writeFileSync(
        entry,
        `console.error('diagnostic ${version}');
setTimeout(() => console.log('healthy ${version}'), 100);`,
      );
      await runPowerShell(`
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:task = [PSCustomObject]@{ Principal = [PSCustomObject]@{ UserId = $sid }; State = 'Ready'; Actions = @([PSCustomObject]@{ Execute = 'old'; Arguments = 'old' }) }
function Get-ScheduledTask { param($TaskName, $ErrorAction) $script:task }
function Set-ScheduledTask { param($TaskName, $Action, $ErrorAction) $script:task.Actions = @($Action) }
function Start-ScheduledTask { param($TaskName) }
${windowsTaskScript({ directory, entry, executable: process.execPath, port: 3776 }, process.env.PATH ?? "")}
`);
      const runner = join(directory, "service.ps1");
      expect(readFileSync(runner, "utf8")).toContain(entry);
      expect(readFileSync(runner, "utf8")).toContain(join(directory, "engine", "node.exe"));
      execFileSync(powershell(), powershellArgs(`& ${psQuote(runner)}; exit $LASTEXITCODE`), {
        windowsHide: true,
        timeout: 15_000,
        env: powershellEnvironment(),
        stdio: "pipe",
      });
      const bytes = readFileSync(join(directory, "host.log"));
      const log = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8");
      expect(log).toContain(`diagnostic ${version}`);
      expect(log).toContain(`healthy ${version}`);
    }
  },
  // Two upgrades each launch PowerShell twice; allow their bounded process
  // operations to finish on a cold Windows runner without changing assertions.
  90_000,
);

it.skipIf(process.platform !== "win32")(
  "refreshes a stopped task's runner and refuses to replace a running one",
  async () => {
    const directory = temporary();
    const options = {
      directory,
      executable: process.execPath,
      entry: join(directory, "new-host.mjs"),
      port: 3776,
    };
    const runner = join(directory, "service.ps1");
    writeFileSync(runner, "old runtime");
    const result = JSON.parse(
      await runPowerShell(`
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:task = [PSCustomObject]@{ Principal = [PSCustomObject]@{ UserId = $sid }; State = 'Ready'; Actions = @([PSCustomObject]@{ Execute = 'old'; Arguments = 'old' }) }
function Get-ScheduledTask { param($TaskName, $ErrorAction) $script:task }
function Set-ScheduledTask { param($TaskName, $Action, $ErrorAction) $script:task.Actions = @($Action) }
function Start-ScheduledTask { param($TaskName) }
${windowsTaskScript(options, process.env.PATH ?? "")}
$updated = [IO.File]::ReadAllText(${psQuote(runner)})
$script:task.State = 'Running'
[IO.File]::WriteAllText(${psQuote(runner)}, 'live runtime')
$rejected = $false
try { ${windowsTaskScript(options, process.env.PATH ?? "")} } catch { $rejected = $true }
@{ updated = $updated; rejected = $rejected; preserved = [IO.File]::ReadAllText(${psQuote(runner)}) } | ConvertTo-Json -Compress
`),
    );
    expect(result.updated).toContain("new-host.mjs");
    expect(result.rejected).toBe(true);
    expect(result.preserved).toBe("live runtime");
  },
);

it.skipIf(process.platform !== "win32")(
  "refuses to stop another user's task during service removal",
  async () => {
    const result = await runPowerShell(`
function Get-ScheduledTask { param($TaskName, $ErrorAction) [PSCustomObject]@{ Principal = [PSCustomObject]@{ UserId = 'S-1-5-18' } } }
function Stop-ScheduledTask { throw 'Should never stop another user' }
try { ${windowsUninstallScript()} } catch { $_.Exception.Message }
`);
    expect(result).toContain("different user");
  },
);

it.skipIf(process.platform !== "win32")(
  "releases a legacy launcher's child tree without touching another process",
  async () => {
    const directory = temporary();
    const entry = join(directory, "legacy.cjs");
    const ready = join(directory, "ready.json");
    writeFileSync(
      entry,
      `const {spawn}=require('node:child_process'); const fs=require('node:fs');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});
fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,child:child.pid}));
setInterval(()=>{},1000);`,
    );
    const owner = spawn(process.execPath, [entry], { windowsHide: true, stdio: "ignore" });
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    let childPid: number | undefined;
    try {
      await vi.waitFor(() => expect(() => readFileSync(ready)).not.toThrow());
      childPid = JSON.parse(readFileSync(ready, "utf8")).child;
      await runPowerShell(`
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$process = Get-CimInstance Win32_Process -Filter 'ProcessId=${owner.pid}'
$arguments = $process.CommandLine.Substring($process.CommandLine.IndexOf(${psQuote(entry)}))
$script:fakeTask = [PSCustomObject]@{ Principal = [PSCustomObject]@{ UserId = $sid }; Actions = @([PSCustomObject]@{ Execute = $process.ExecutablePath; Arguments = $arguments }) }
function Get-ScheduledTask { param($TaskName,$ErrorAction) $script:fakeTask }
function Stop-ScheduledTask { param($TaskName,$ErrorAction) }
function Unregister-ScheduledTask { param($TaskName,$Confirm) }
${windowsUninstallScript()}
`);
      await vi.waitFor(() => expect(() => process.kill(owner.pid!, 0)).toThrow());
      await vi.waitFor(() => expect(() => process.kill(childPid!, 0)).toThrow());
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    } finally {
      for (const pid of [owner.pid, childPid, unrelated.pid]) {
        if (pid) {
          try {
            process.kill(pid);
          } catch {
            /* already exited */
          }
        }
      }
    }
  },
);

it.skipIf(process.platform !== "win32")(
  "protects Windows credentials and reuses only this user's unlimited task",
  async () => {
    const directory = temporary();
    await protectWindowsDirectory(directory);
    writeFileSync(join(directory, "credential.json"), "secret");
    const acl = JSON.parse(
      await runPowerShell(`
$acl = Get-Acl -LiteralPath ${psQuote(directory)}
$file = Get-Acl -LiteralPath ${psQuote(join(directory, "credential.json"))}
@{ protected = $acl.AreAccessRulesProtected; owner = $acl.Owner; rules = @($file.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) } | ConvertTo-Json -Compress
`),
    );
    expect(acl.protected).toBe(true);
    expect(acl.rules).not.toContain("S-1-1-0");
    expect(acl.rules).not.toContain("S-1-5-32-545");
    // Use the real ScheduledTasks constructors but never register a task in the
    // developer's account. Capture the resulting definition for assertions.
    const options = {
      directory,
      port: 3774,
      executable: process.execPath,
      entry: join(directory, "host.mjs"),
    };
    const result = JSON.parse(
      await runPowerShell(`
$script:registeredTask = $null
$script:registrations = 0
$script:starts = 0
$script:migrations = 0
function Get-ScheduledTask { param($TaskName, $ErrorAction) return $script:registeredTask }
function Set-ScheduledTask {
  param($TaskName, $Action, $ErrorAction)
  $script:migrations++
  $script:registeredTask.Actions = @($Action)
}
function Register-ScheduledTask {
  param($TaskName, $Action, $Principal, $Trigger, $Settings, $Description)
  $script:registrations++
  $script:registeredTask = [PSCustomObject]@{ Principal = $Principal; Actions = @($Action) }
  @{ user = $Principal.UserId; sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; logon = $Principal.LogonType.ToString(); limit = $Settings.ExecutionTimeLimit; instances = $Settings.MultipleInstances.ToString(); executable = $Action.Execute; action = $Action.Arguments } | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psQuote(join(directory, "task.json"))}
}
function Start-ScheduledTask { param($TaskName) $script:starts++ }
${windowsTaskScript(options, process.env.PATH ?? "")}
$script:registeredTask.Actions = @([PSCustomObject]@{ Execute = 'powershell.exe'; Arguments = 'old' })
${windowsTaskScript(options, process.env.PATH ?? "")}
${windowsTaskScript(options, process.env.PATH ?? "")}
$definition = Get-Content -LiteralPath ${psQuote(join(directory, "task.json"))} -Raw | ConvertFrom-Json
$script:registeredTask = [PSCustomObject]@{ Principal = [PSCustomObject]@{ UserId = 'S-1-5-18' } }
$rejected = $false
try {
  ${windowsTaskScript(options, process.env.PATH ?? "")}
} catch {
  if ($_.Exception.Message -notlike '*different user*') { throw }
  $rejected = $true
}
@{ definition = $definition; registrations = $script:registrations; migrations = $script:migrations; starts = $script:starts; rejected = $rejected; userSid = if ($definition.user -match '^S-1-') { $definition.user } else { ([Security.Principal.NTAccount]::new($definition.user)).Translate([Security.Principal.SecurityIdentifier]).Value } } | ConvertTo-Json -Compress
`),
    );
    expect(result.userSid).toBe(result.definition.sid);
    expect(result.registrations).toBe(1);
    expect(result.starts).toBe(3);
    expect(result.migrations).toBe(1);
    expect(result.rejected).toBe(true);
    expect(["Interactive", "3"]).toContain(result.definition.logon);
    expect(result.definition.limit).toBe("PT0S");
    expect(["IgnoreNew", "2"]).toContain(result.definition.instances);
    expect(result.definition.executable).toBe(join(directory, "service-launcher-v3.exe"));
    const executable = readFileSync(result.definition.executable);
    const peHeader = executable.readUInt32LE(0x3c);
    expect(executable.readUInt16LE(peHeader + 24 + 68)).toBe(2); // Windows GUI subsystem
    expect(Buffer.from(result.definition.action, "base64").toString("utf16le")).toContain(
      "service.ps1",
    );

    // Exercise the compiled GUI executable, not just the task definition. The
    // child must have no console and errors must reach the task's exit status.
    const probe = join(directory, "console.json");
    execFileSync(
      result.definition.executable,
      powershellArgs(`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
@{ console = [ConsoleProbe]::GetConsoleWindow().ToInt64(); pid = $PID } | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psQuote(probe)}
`).slice(-1),
      { windowsHide: true, timeout: 30_000 },
    );
    expect(JSON.parse(readFileSync(probe, "utf8").replace(/^\uFEFF/, "")).console).toBe(0);
    // A failed host is restarted after a short delay; the last failure is the
    // task's result. A graceful exit (0) is never restarted.
    const runs = join(directory, "runs.txt");
    const run = (code: number) => {
      try {
        execFileSync(
          result.definition.executable,
          powershellArgs(
            `Add-Content -LiteralPath ${psQuote(runs)} -Value run; exit ${code}`,
          ).slice(-1),
          {
            windowsHide: true,
            timeout: 30_000,
            env: { ...process.env, BYCODA_LAUNCHER_RESTARTS: "1" },
          },
        );
        return 0;
      } catch (error) {
        return (error as { status?: number }).status;
      }
    };
    const count = () => readFileSync(runs, "utf8").trim().split(/\s+/).length;
    expect(run(23)).toBe(23);
    expect(count()).toBe(2);
    rmSync(runs);
    expect(run(0)).toBe(0);
    expect(count()).toBe(1);
  },
  // Three sequential PowerShell calls each have their own 30s process timeout.
  // Leave room for all three to settle before test teardown removes their files.
  100_000,
);

it.skipIf(process.platform !== "win32")(
  "parses the Windows bootstrap with Windows PowerShell",
  () => {
    const script = readFileSync("src-tauri/src/remote_bootstrap.ps1", "utf8")
      .replace("@@VERSION@@", "'test'")
      .replace("@@RELEASE@@", "'https://example.invalid'")
      .replace("@@ACL@@", readFileSync("host/windows-acl.ps1", "utf8"));
    const file = join(temporary(), "bootstrap.ps1");
    writeFileSync(file, script);
    const result = execFileSync(
      powershell(),
      powershellArgs(
        `$tokens = $null; $errors = $null; $null = [Management.Automation.Language.Parser]::ParseFile(${psQuote(file)}, [ref] $tokens, [ref] $errors); if ($errors.Count) { $errors | Out-String | Write-Output; exit 1 }`,
      ),
      { encoding: "utf8", env: powershellEnvironment() },
    );
    expect(result).toBe("");
  },
);
