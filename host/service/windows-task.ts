import { dirname, join } from "node:path";
import { psQuote } from "../windows";

export type WindowsServiceOptions = {
  directory: string;
  port: number;
  executable: string;
  entry: string;
};

/** Keep executable identity stable; never overwrite a locked runtime in place. */
function executableSetupScript(source: string, directory: string, name: string): string {
  const engine = join(directory, "engine");
  return `
$sourceBinary = ${psQuote(source)}
$stableBinary = ${psQuote(join(engine, name))}
$sourceHash = (Get-FileHash -LiteralPath $sourceBinary -Algorithm SHA256 -ErrorAction Stop).Hash
if (-not [IO.File]::Exists($stableBinary) -or (Get-FileHash -LiteralPath $stableBinary -Algorithm SHA256 -ErrorAction Stop).Hash -ne $sourceHash) {
  [IO.Directory]::CreateDirectory(${psQuote(engine)}) | Out-Null
  $stagedBinary = Join-Path ${psQuote(engine)} ('stage-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::Copy($sourceBinary, $stagedBinary)
    if ((Get-FileHash -LiteralPath $stagedBinary -Algorithm SHA256 -ErrorAction Stop).Hash -ne $sourceHash) { throw 'The staged host executable checksum changed.' }
    if ([IO.File]::Exists($stableBinary)) {
      [IO.File]::Replace($stagedBinary, $stableBinary, [Management.Automation.Language.NullString]::Value)
    } else {
      [IO.File]::Move($stagedBinary, $stableBinary)
    }
  } finally {
    if ([IO.File]::Exists($stagedBinary)) { [IO.File]::Delete($stagedBinary) }
  }
}
`;
}

export function windowsNodeSetupScript(executable: string, directory: string): string {
  return executableSetupScript(executable, directory, "node.exe");
}

/** Task Scheduler owns a console-free launcher, which starts Node directly. */
export function windowsTaskScript(options: WindowsServiceOptions, path: string): string {
  const executable = join(options.directory, "engine", "node.exe");
  const sourceLauncher = join(dirname(options.entry), "bycoda-host-launcher.exe");
  const launcher = join(options.directory, "engine", "bycoda-host-launcher.exe");
  const configPath = join(options.directory, "service-launcher.json");
  // A complete Windows filename cannot contain quotes or end in a backslash.
  const taskArgs = `"${configPath}"`;
  const config = JSON.stringify({ ...options, executable, path });
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
  if ($task.State -in @('Queued', 'Unknown')) { throw 'The host task has not settled. Wait for its outcome before changing its service runtime.' }
}
if (-not [IO.File]::Exists(${psQuote(sourceLauncher)})) {
  throw 'The packaged Windows Host launcher is missing. Use a complete matching Host package.'
}
$action = New-ScheduledTaskAction -Execute ${psQuote(launcher)} -Argument ${psQuote(taskArgs)}
$configuration = ${psQuote(config)}
if ($null -ne $task -and $task.State -eq 'Running') {
  if ($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne $action.Execute -or $task.Actions[0].Arguments -ne $action.Arguments -or
      -not [IO.File]::Exists(${psQuote(configPath)}) -or [IO.File]::ReadAllText(${psQuote(configPath)}) -ne $configuration) {
    throw 'Stop the existing host before changing its service runtime.'
  }
  foreach ($pair in @(@(${psQuote(executable)}, ${psQuote(options.executable)}), @(${psQuote(launcher)}, ${psQuote(sourceLauncher)}))) {
    if ((Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256 -ErrorAction Stop).Hash -ne (Get-FileHash -LiteralPath $pair[1] -Algorithm SHA256 -ErrorAction Stop).Hash) {
      throw 'Stop the existing host before changing its service executables.'
    }
  }
} else {
  ${windowsNodeSetupScript(options.executable, options.directory)}
  ${executableSetupScript(sourceLauncher, options.directory, "bycoda-host-launcher.exe")}
  $temporary = ${psQuote(configPath)} + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, $configuration, [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists(${psQuote(configPath)})) {
      [IO.File]::Replace($temporary, ${psQuote(configPath)}, [Management.Automation.Language.NullString]::Value)
    } else {
      [IO.File]::Move($temporary, ${psQuote(configPath)})
    }
  } finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
  }
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
# Task Scheduler's default DACL follows the registering token: an elevated
# install leaves the task owned by Administrators with read-only user access,
# which later blocks removal from the same user's filtered token.
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$registered = $scheduler.GetFolder('\\').GetTask($name)
if ($null -eq $task -or $registered.GetSecurityDescriptor(7) -notlike "O:\${sid}*(A;;FA;;;\${sid})*") {
  try {
    $registered.SetSecurityDescriptor("O:\${sid}G:\${sid}D:(A;;FA;;;\${sid})(A;;FA;;;BA)(A;;FA;;;SY)", 0)
  } catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    throw "The Bycoda Host task could not be secured for its owner: $($cause.Message) Repair the task's security descriptor from an elevated PowerShell, then retry."
  }
}
Start-ScheduledTask -TaskName $name
`;
}
