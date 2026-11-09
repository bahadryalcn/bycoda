import { spawn } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
import { writeFileAtomic } from "../storage/atomic-write";

const RESTRICT_FAILED = "Secret file permissions could not be restricted.";

/** Replaces the inherited ACL with the current user only. The path reaches PowerShell through
 * the environment, never through the script text. */
const RESTRICT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = $env:BYCODA_SECRET_PATH
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$item = Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Secret file must not be a link.' }
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
$item.SetAccessControl($acl)
`;

/** Directory variant: current user only, inherited by children, no inherited entries. */
const RESTRICT_DIRECTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = $env:BYCODA_SECRET_PATH
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$item = Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Secret directory must not be a link.' }
if (-not $item.PSIsContainer) { throw 'Secret path must be a directory.' }
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
$item.SetAccessControl($acl)
`;

function runRestrictScript(script: string, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env, BYCODA_SECRET_PATH: path },
      },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(RESTRICT_FAILED));
    }, 15_000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error(RESTRICT_FAILED));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(RESTRICT_FAILED));
    });
  });
}

/** Owner-only file for shell use: Windows ACL for the current user, mode 0600 elsewhere. */
export async function restrictSecretFile(path: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, 0o600);
    return;
  }
  await runRestrictScript(RESTRICT_SCRIPT, path);
}

/** Owner-only secrets directory on Windows; a no-op elsewhere, where file modes already apply. */
export async function restrictSecretDirectory(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  await runRestrictScript(RESTRICT_DIRECTORY_SCRIPT, path);
}

/** Writes the value and restricts the final file. A file that cannot be restricted is removed. */
export async function writeSecretFile(
  path: string,
  value: string,
  restrict: (path: string) => Promise<void> = restrictSecretFile,
): Promise<void> {
  await writeFileAtomic(path, value, { mode: 0o600 });
  try {
    await restrict(path);
  } catch {
    await rm(path, { force: true }).catch(() => undefined);
    throw new Error(RESTRICT_FAILED);
  }
}

export async function removeSecretFile(path: string): Promise<void> {
  await rm(path, { force: true });
}
