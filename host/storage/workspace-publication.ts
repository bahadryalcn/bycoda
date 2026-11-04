import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { powershell, powershellArgs, powershellEnvironment } from "../windows";

// File.Replace calls ReplaceFileW, retaining the destination's Windows security
// descriptor. Paths are data on stdin, never PowerShell source or arguments.
const REPLACE_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.WriteLine('READY')
$request = [Console]::In.ReadLine() | ConvertFrom-Json
if ($request.protect) {
  $section = [System.Security.AccessControl.AccessControlSections]::Access
  $acl = [System.IO.File]::GetAccessControl([string]$request.target, $section)
  $acl.SetAccessRuleProtection($acl.AreAccessRulesProtected, $true)
  [System.IO.File]::SetAccessControl([string]$request.staged, $acl)
  $actual = [System.IO.File]::GetAccessControl([string]$request.staged, $section)
  $expectedSddl = $acl.GetSecurityDescriptorSddlForm($section)
  $actualSddl = $actual.GetSecurityDescriptorSddlForm($section)
  [string[]]$expectedRules = foreach ($rule in [regex]::Matches($expectedSddl, '[(][^)]*[)]')) { $rule.Value }
  [string[]]$actualRules = foreach ($rule in [regex]::Matches($actualSddl, '[(][^)]*[)]')) { $rule.Value }
  [array]::Sort($expectedRules, [StringComparer]::Ordinal)
  [array]::Sort($actualRules, [StringComparer]::Ordinal)
  $expectedFlags = [regex]::Replace($expectedSddl, '[(][^)]*[)]', '')
  $actualFlags = [regex]::Replace($actualSddl, '[(][^)]*[)]', '')
  if ($expectedFlags -match '[()]' -or $actualFlags -match '[()]' -or $expectedFlags -cne $actualFlags -or !$acl.AreAccessRulesCanonical -or !$actual.AreAccessRulesCanonical -or $acl.AreAccessRulesProtected -ne $actual.AreAccessRulesProtected -or [string]::Join('|', $expectedRules) -cne [string]::Join('|', $actualRules)) { throw 'Staging DACL differs from original' }
} else {
  [System.IO.File]::Replace([string]$request.staged, [string]$request.target, [string]$request.backup)
}
`;

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
      else
        reject(
          new Error(
            `Windows ${protect ? "staging permissions failed" : "replacement outcome is uncertain"}${timedOut ? " (timeout)" : ""}: ${diagnostic}`,
          ),
        );
    });
    child.stdin.on("error", () => {});
  });
}

interface PublicationOperations {
  write: (handle: FileHandle, content: string) => Promise<void>;
  sync: (handle: FileHandle) => Promise<void>;
  windows: typeof windowsFileOperation;
  rename: typeof rename;
  remove: typeof rm;
}

const publicationOperations: PublicationOperations = {
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
  let publishing = false;
  let handle;
  try {
    handle = await open(staged, "wx", 0o600);
    const created = await handle.stat();
    if (process.platform === "win32") {
      await operations.windows(staged, target, true, backup);
    } else {
      const args =
        process.platform === "linux"
          ? ["--attributes-only", "--preserve=mode,ownership,xattr", "--", target, staged]
          : process.platform === "darwin"
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
    if (process.platform !== "win32") {
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
    if (process.platform === "win32") {
      await operations.windows(staged, target, false, backup, permit);
      await operations.remove(backup, { force: true }).catch(() => {});
    } else {
      await permit();
      await operations.rename(staged, target);
    }
    if (process.platform !== "win32") {
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
