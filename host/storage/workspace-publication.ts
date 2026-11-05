import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import {
  powershell,
  powershellArgs,
  powershellEnvironment,
  powershellErrorText,
  windowsCoreModulesImport,
} from "../windows";

// File.Replace calls ReplaceFileW, retaining the destination's Windows security
// descriptor. Paths are data on stdin, never PowerShell source or arguments.
//
// `protect` gives the staged file the target's DACL before any content is
// written (.NET writes only the sections marked modified, so the DACL is always
// marked). A protected DACL is copied and compared in full. An unprotected DACL
// is copied as its explicit ACEs only: Windows recomputes the inherited ACEs from
// the shared parent directory, so the target's inherited ACEs and the
// auto-inheritance bookkeeping flags (AI, AR, which grant nothing) can
// legitimately differ from the staged file's. Explicit ACEs, the protection
// flag and a null DACL must match exactly.
//
// Errors are written as plain text; progress is silenced and the Utility module
// is imported by path so ConvertFrom-Json triggers no module discovery.
const REPLACE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  ${windowsCoreModulesImport}
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.WriteLine('READY')
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  if ($request.protect) {
    $section = [System.Security.AccessControl.AccessControlSections]::Access
    $acl = [System.IO.File]::GetAccessControl([string]$request.target, $section)
    $protected = $acl.AreAccessRulesProtected
    function Get-BycodaDacl($security) {
      if (!$security.AreAccessRulesCanonical) { throw 'Workspace file DACL is not canonical' }
      $sddl = $security.GetSecurityDescriptorSddlForm($section)
      [string[]]$rules = @(foreach ($rule in [regex]::Matches($sddl, '[(][^)]*[)]')) {
        if ($protected -or $rule.Value.Split(';')[1] -cnotmatch '^(?:..)*ID') { $rule.Value }
      })
      [array]::Sort($rules, [StringComparer]::Ordinal)
      $flags = [regex]::Replace($sddl, '[(][^)]*[)]', '') -creplace 'A[IR]', ''
      if ($flags -match '[()]') { throw 'Workspace file DACL has an unsupported form' }
      $flags + '|' + [string]::Join('|', $rules)
    }
    $expected = Get-BycodaDacl $acl
    # SetAccessControl persists only the sections modified on this object, so
    # the DACL is always marked modified; otherwise a protected DACL is never
    # written and the staged file keeps its inherited one.
    if ($protected) {
      $acl.SetAccessRuleProtection($true, $true)
    } else {
      $acl.SetAccessRuleProtection($true, $false)
      $acl.SetAccessRuleProtection($false, $true)
    }
    [System.IO.File]::SetAccessControl([string]$request.staged, $acl)
    $actual = [System.IO.File]::GetAccessControl([string]$request.staged, $section)
    if ($actual.AreAccessRulesProtected -ne $protected -or (Get-BycodaDacl $actual) -cne $expected) { throw 'Staging DACL differs from original' }
  } else {
    [System.IO.File]::Replace([string]$request.staged, [string]$request.target, [string]$request.backup)
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/** The failure text keeps PowerShell's message, never its CLIXML records. */
export function windowsOperationError(
  protect: boolean,
  timedOut: boolean,
  stderr: string,
  code: number | null,
): Error {
  const detail = powershellErrorText(stderr) || `exit code ${code ?? "unknown"}`;
  return new Error(
    `Windows ${protect ? "staging permissions failed" : "replacement outcome is uncertain"}${timedOut ? " (timeout)" : ""}: ${detail}`,
  );
}

async function windowsFileOperation(
  staged: string,
  target: string,
  protect: boolean,
  backup: string,
  beforePermit?: () => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(powershell(), powershellArgs(REPLACE_SCRIPT), {
      windowsHide: true,
      env: powershellEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let diagnostic = "";
    let timedOut = false;
    let ready = false;
    let validationError: unknown;
    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
      if (ready || !stdout.includes("\n")) return;
      ready = true;
      if (stdout.trim() !== "READY") {
        validationError = new Error(
          "Windows publication helper returned an invalid readiness response",
        );
        child.kill();
        return;
      }
      void (async () => {
        try {
          await beforePermit?.();
          child.stdin.end(`${JSON.stringify({ staged, target, protect, backup })}\n`);
        } catch (error) {
          validationError = error;
          child.kill();
        }
      })();
    });
    child.stderr.on("data", (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-2000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (validationError) reject(validationError);
      else if (code === 0 && !timedOut && ready) resolve();
      else reject(windowsOperationError(protect, timedOut, diagnostic, code));
    });
    child.stdin.on("error", () => {});
  });
}

interface PublicationOperations {
  platform: NodeJS.Platform;
  write: (handle: FileHandle, content: string) => Promise<void>;
  sync: (handle: FileHandle) => Promise<void>;
  windows: typeof windowsFileOperation;
  rename: typeof rename;
  remove: typeof rm;
}

const publicationOperations: PublicationOperations = {
  platform: process.platform,
  write: (handle, content) => handle.writeFile(content, "utf8"),
  sync: (handle) => handle.sync(),
  windows: windowsFileOperation,
  rename,
  remove: rm,
};

/** Publish only after validation; keep staged evidence if publication is uncertain. */
export async function publishWorkspaceFile(
  target: string,
  content: string,
  original: Stats,
  validate: () => Promise<void>,
  operations: PublicationOperations = publicationOperations,
): Promise<void> {
  const directory = dirname(target);
  const staged = join(directory, `.${basename(target)}.bycoda-${randomUUID()}.tmp`);
  const backup = join(directory, `.${basename(target)}.bycoda-${randomUUID()}.backup`);
  const { platform } = operations;
  let publishing = false;
  let handle;
  try {
    handle = await open(staged, "wx", 0o600);
    const created = await handle.stat();
    if (platform === "win32") {
      try {
        await operations.windows(staged, target, true, backup);
      } catch (error) {
        // A target that was removed or replaced meanwhile is a conflict, not a
        // permissions defect: report the caller's conflict error instead.
        await validate();
        throw error;
      }
    } else {
      const args =
        platform === "linux"
          ? ["--attributes-only", "--preserve=mode,ownership,xattr", "--", target, staged]
          : platform === "darwin"
            ? ["-p", "--", target, staged]
            : null;
      if (!args) throw new Error("Workspace save cannot preserve permissions on this platform");
      await execFileAsync("/bin/cp", args, { timeout: 10_000, maxBuffer: 32_768 });
      const info = await handle.stat();
      if (
        info.dev !== created.dev ||
        info.ino !== created.ino ||
        info.uid !== original.uid ||
        info.gid !== original.gid ||
        (info.mode & 0o7777) !== (original.mode & 0o7777)
      )
        throw new Error("Workspace staging could not preserve file identity and permissions");
      await handle.truncate(0);
    }
    await operations.write(handle, content);
    if (platform !== "win32") {
      const written = await handle.stat();
      if (
        written.uid !== original.uid ||
        written.gid !== original.gid ||
        (written.mode & 0o7777) !== (original.mode & 0o7777)
      )
        throw new Error("Workspace staging could not preserve file permissions after writing");
    }
    await operations.sync(handle);
    await handle.close();
    handle = undefined;
    const permit = async () => {
      await validate();
      const stageInfo = await lstat(staged);
      if (
        stageInfo.isSymbolicLink() ||
        stageInfo.dev !== created.dev ||
        stageInfo.ino !== created.ino ||
        stageInfo.nlink !== 1
      )
        throw new Error("Workspace staging file changed before publication");
      publishing = true;
    };
    if (platform === "win32") {
      await operations.windows(staged, target, false, backup, permit);
      await operations.remove(backup, { force: true }).catch(() => {});
    } else {
      await permit();
      await operations.rename(staged, target);
    }
    if (platform !== "win32") {
      const parent = await open(directory, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    if (!publishing) await operations.remove(staged, { force: true }).catch(() => {});
    if (publishing)
      throw new Error(
        `Workspace save outcome uncertain; target: ${target}; staged candidate: ${staged}; backup candidate: ${backup}`,
        {
          cause: error,
        },
      );
    throw error;
  }
}
