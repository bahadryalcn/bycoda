import { execFile } from "node:child_process";
import { join } from "node:path";
import aclScript from "./windows-acl.ps1?raw";
import taskAccessScript from "./windows-task-access.ps1?raw";
export { windowsTaskScript, windowsNodeSetupScript } from "./service/windows-task";
export type { WindowsServiceOptions } from "./service/windows-task";

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
  // Cast: Expo's global types (mobile typecheck) make NODE_ENV required on ProcessEnv.
  Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"),
  ) as NodeJS.ProcessEnv;

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
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); try { & ([ScriptBlock]::Create([Console]::In.ReadToEnd())) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
      ],
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

/** Windows PowerShell 5.1 autoloads even its own Management/Utility/Security
 * modules by first analysing every module on PSModulePath. That analysis is
 * cached only under the LocalApplicationData known folder; when it is cold or
 * unresolvable (an isolated or fresh profile), each launch rescans all installed
 * modules, which takes tens of seconds on machines with large module sets.
 * Importing the in-box modules by their $PSHOME path skips that discovery. */
export const windowsCoreModulesImport =
  'Import-Module -Name "$PSHOME\\Modules\\Microsoft.PowerShell.Management", "$PSHOME\\Modules\\Microsoft.PowerShell.Utility", "$PSHOME\\Modules\\Microsoft.PowerShell.Security"';

export async function protectWindowsDirectory(directory: string): Promise<void> {
  await runPowerShell(
    `${windowsCoreModulesImport}\n${aclScript}\nProtect-BycodaDirectory ${psQuote(directory)}`,
  );
}

export function windowsUninstallPreflightScript(): string {
  return `${taskAccessScript}\nAssert-BycodaTaskRemovalAccess ("Bycoda Host-" + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)`;
}

export async function preflightWindowsHostUninstall(): Promise<void> {
  await runPowerShell(windowsUninstallPreflightScript());
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
    # Match the exact registered executable AND literal arguments, never a name.
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
