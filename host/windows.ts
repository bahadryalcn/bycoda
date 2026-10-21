import { execFile } from "node:child_process";
import { join } from "node:path";
import aclScript from "./windows-acl.ps1?raw";
import { windowsServiceLauncherSource } from "./windows-service-launcher";

export const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const powershellArgs = (script: string) => [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
];
export const powershell = () =>
  join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

// Node may inherit PowerShell 7's module paths. Windows PowerShell 5.1 must
// build its own paths at startup so it can load its compatible system modules.
export const powershellEnvironment = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"));

/** Windows PowerShell writes progress records to a redirected stderr as
 * CLIXML. A message that starts with that marker also makes a parent
 * PowerShell, such as the scheduled task's runner, try to parse it as XML. */
export function powershellErrorText(stderr: string): string {
  return stderr
    .replace(/#< CLIXML\r?\n?/g, "")
    .replace(/<Objs [\s\S]*?<\/Objs>/g, "")
    .trim();
}

export async function runPowerShell(script: string): Promise<string> {
  // Send script contents through stdin, avoiding Windows' command-line limit
  // when the user's PATH or profile directory is long.
  return new Promise((resolve, reject) => {
    const child = execFile(
      powershell(),
      powershellArgs(
        "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); try { & ([ScriptBlock]::Create([Console]::In.ReadToEnd())) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
      ),
      {
        env: powershellEnvironment(),
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 128 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(powershellErrorText(stderr) || error.message));
        else resolve(stdout);
      },
    );
    child.stdin!.on("error", () => {
      /* execFile reports an early exit */
    });
    child.stdin!.end(script, "utf8");
  });
}

export async function protectWindowsDirectory(directory: string): Promise<void> {
  await runPowerShell(`${aclScript}\nProtect-BycodaDirectory ${psQuote(directory)}`);
}

export type WindowsServiceOptions = {
  directory: string;
  port: number;
  executable: string;
  entry: string;
};

/** Keep the listening executable's firewall identity independent of host releases.
 * Never overwrite it in place: a locked engine must fail without damaging the
 * previous installation. The caller has already stopped the service. */
export function windowsNodeSetupScript(executable: string, directory: string): string {
  const engine = join(directory, "engine");
  const node = join(engine, "node.exe");
  return `
$sourceNode = ${psQuote(executable)}
$stableNode = ${psQuote(node)}
$sourceHash = (Get-FileHash -LiteralPath $sourceNode -Algorithm SHA256).Hash
if (-not [IO.File]::Exists($stableNode) -or (Get-FileHash -LiteralPath $stableNode -Algorithm SHA256).Hash -ne $sourceHash) {
  [IO.Directory]::CreateDirectory(${psQuote(engine)}) | Out-Null
  $stagedNode = Join-Path ${psQuote(engine)} ('node-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::Copy($sourceNode, $stagedNode)
    if ((Get-FileHash -LiteralPath $stagedNode -Algorithm SHA256).Hash -ne $sourceHash) { throw 'The staged host engine checksum changed.' }
    if ([IO.File]::Exists($stableNode)) {
      [IO.File]::Replace($stagedNode, $stableNode, [Management.Automation.Language.NullString]::Value)
    } else {
      [IO.File]::Move($stagedNode, $stableNode)
    }
  } finally {
    if ([IO.File]::Exists($stagedNode)) { [IO.File]::Delete($stagedNode) }
  }
}
`;
}

export function windowsServiceRunner(options: WindowsServiceOptions, path: string): string {
  // Windows PowerShell 5.1 treats redirected native stderr as ErrorRecords.
  // A provider diagnostic must be logged without terminating the host pipeline.
  // The native exit code, rather than stderr output, decides service recovery.
  return `$ErrorActionPreference = 'Stop'\n$env:PATH = ${psQuote(path)}\n$global:LASTEXITCODE = 1\n$ErrorActionPreference = 'Continue'\n& ${psQuote(options.executable)} ${[options.entry, "serve", "--data-dir", options.directory, "--port", String(options.port)].map(psQuote).join(" ")} >> ${psQuote(join(options.directory, "host.log"))} 2>&1\nexit $global:LASTEXITCODE`;
}

/** Task Scheduler owns the process, independently of the SSH session. An
 * interactive token preserves this user's normal network/credential access.
 * S4U cannot access network or encrypted files and is unsuitable for agents. */
export function windowsTaskScript(options: WindowsServiceOptions, path: string): string {
  const executable = join(options.directory, "engine", "node.exe");
  const runner = windowsServiceRunner({ ...options, executable }, path);
  const runnerPath = join(options.directory, "service.ps1");
  const launcher = `$ErrorActionPreference = 'Stop'; try { & ([ScriptBlock]::Create([IO.File]::ReadAllText(${psQuote(runnerPath)}))) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const launcherPath = join(options.directory, "service-launcher-v3.exe");
  const taskArgs = powershellArgs(launcher).at(-1)!;
  return `
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
$name = "Bycoda Host-$sid"
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($null -ne $task) {
  $taskSid = [string] $task.Principal.UserId
  if ($taskSid -notmatch '^S-1-') {
    $taskSid = ([Security.Principal.NTAccount]::new($taskSid)).Translate([Security.Principal.SecurityIdentifier]).Value
  }
  if ($taskSid -ne $sid) { throw 'The existing Bycoda task belongs to a different user.' }
}
if (-not [IO.File]::Exists(${psQuote(launcherPath)})) {
  Add-Type -TypeDefinition ${psQuote(windowsServiceLauncherSource)} -Language CSharp -OutputAssembly ${psQuote(launcherPath)} -OutputType WindowsApplication -ErrorAction Stop
}
$action = New-ScheduledTaskAction -Execute ${psQuote(launcherPath)} -Argument ${psQuote(taskArgs)}
$runner = ${psQuote(runner)}
if ($null -ne $task -and $task.State -eq 'Running') {
  if (-not [IO.File]::Exists(${psQuote(runnerPath)}) -or [IO.File]::ReadAllText(${psQuote(runnerPath)}) -ne $runner) {
    throw 'Stop the existing host before changing its service runtime.'
  }
  if ((Get-FileHash -LiteralPath ${psQuote(executable)} -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath ${psQuote(options.executable)} -Algorithm SHA256).Hash) {
    throw 'Stop the existing host before changing its Node engine.'
  }
} else {
  ${windowsNodeSetupScript(options.executable, options.directory)}
  [IO.File]::WriteAllText(${psQuote(runnerPath)}, $runner, [Text.UTF8Encoding]::new($false))
}
if ($null -eq $task) {
  $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Bycoda remote agent host for this user' | Out-Null
} else {
  if ($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne $action.Execute -or $task.Actions[0].Arguments -ne $action.Arguments) {
    Set-ScheduledTask -TaskName $name -Action $action -ErrorAction Stop | Out-Null
  }
}
Start-ScheduledTask -TaskName $name
`;
}

/** Called after graceful host shutdown. Release the entire owned launcher tree,
 * including legacy hosts that finished cleanup but retained native handles. */
export function windowsUninstallScript(): string {
  return `
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$name = "Bycoda Host-$sid"
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($null -ne $task) {
  $taskSid = [string] $task.Principal.UserId
  if ($taskSid -notmatch '^S-1-') {
    $taskSid = ([Security.Principal.NTAccount]::new($taskSid)).Translate([Security.Principal.SecurityIdentifier]).Value
  }
  if ($taskSid -ne $sid) { throw 'The existing Bycoda task belongs to a different user.' }
  foreach ($action in $task.Actions) {
    # Match the exact registered executable AND encoded arguments, never a name.
    $owners = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -eq $action.Execute -and $action.Arguments -and $_.CommandLine -and
      $_.CommandLine.EndsWith($action.Arguments, [StringComparison]::Ordinal)
    })
    foreach ($owner in $owners) {
      & "$env:SystemRoot\\System32\\taskkill.exe" /PID $owner.ProcessId /T /F | Out-Null
      if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue)) {
        throw 'The old host service process tree did not stop.'
      }
    }
  }
  Stop-ScheduledTask -TaskName $name -ErrorAction Stop
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
}
`;
}
