import { spawn } from "node:child_process";
import { dirname } from "node:path";

export type RevertFileGuard = { check(): void; release(): Promise<void> };
export type RevertGuardSession = {
  /** One guard at a time: release it before acquiring the next. */
  acquire(abs: string): Promise<RevertFileGuard>;
  /** Stops the shared helper; call once the revert is finished. */
  close(): Promise<void>;
};

const GUARD_TIMEOUT_MS = 15_000;
const GUARD_STARTUP_TIMEOUT_MS = 30_000;

// Node's Windows file handles always share writes. A hidden helper supplies
// mandatory deny-write and deny-directory-rename handles for revert only. One
// helper serves a whole revert and holds the handles of one file at a time, so a
// large turn pays the PowerShell start once instead of once per file.
// Requests travel as JSON lines on stdin, never interpolated into executable
// text. Protocol per request: request line -> READY | FAILED <reason>; after
// READY, any line (or EOF) releases the handles and answers RELEASED.
const WINDOWS_GUARD = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RevertGuard {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
}
'@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $held = [Collections.Generic.List[IDisposable]]::new()
  $failure = $null
  try {
    $request = $line | ConvertFrom-Json
    foreach ($directory in $request.directories) {
      $handle = [RevertGuard]::CreateFile($directory, 0x81, 3, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
      if ($handle.IsInvalid) { throw 'A parent directory is busy or unavailable' }
      $held.Add($handle)
      if (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A parent is a linked directory' }
    }
    if ([IO.File]::Exists($request.path)) {
      $held.Add([IO.File]::Open($request.path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::Read -bor [IO.FileShare]::Delete)))
    }
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()
    [void][Console]::In.ReadLine()
  } catch {
    $failure = ($_.Exception.Message -replace '[\\r\\n]+', ' ')
  } finally {
    foreach ($handle in $held) { $handle.Dispose() }
  }
  if ($null -ne $failure) { [Console]::Out.WriteLine('FAILED ' + $failure) } else { [Console]::Out.WriteLine('RELEASED') }
  [Console]::Out.Flush()
}
`;

class GuardHelper {
  readonly child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_GUARD],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  closed = false;
  failure: Error | undefined;
  detail = "";
  readonly completion: Promise<void>;
  private lines: string[] = [];
  private partial = "";
  private waiting: ((line: string | null) => void) | undefined;

  constructor() {
    this.completion = new Promise<void>((resolve) => {
      const finish = () => {
        this.closed = true;
        this.waiting?.(null);
        this.waiting = undefined;
        resolve();
      };
      this.child.once("close", finish);
      this.child.once("error", (error) => {
        this.failure = error;
        finish();
      });
    });
    // Multi-byte paths in messages must not split across chunks.
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (bytes) => {
      if (this.detail.length < 4000) this.detail += String(bytes);
    });
    this.child.stdout.on("data", (bytes) => {
      this.partial += String(bytes);
      const parts = this.partial.split(/\r?\n/);
      this.partial = parts.pop() ?? "";
      for (const line of parts) {
        if (this.waiting) {
          const waiting = this.waiting;
          this.waiting = undefined;
          waiting(line);
        } else this.lines.push(line);
      }
    });
    this.child.stdin.on("error", () => {});
  }

  send(text: string) {
    this.child.stdin.write(text);
  }

  /** Next protocol line, or null once the helper has exited. */
  next(): Promise<string | null> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  async nextWithin(ms: number): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("timeout");
    const result = await Promise.race([
      this.next(),
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), ms);
      }),
    ]);
    clearTimeout(timer);
    if (result !== timedOut) return result;
    this.child.kill();
    this.child.stdin.end();
    await this.completion;
    throw new Error("File guard timed out");
  }
}

/** Parent directories from the checkout root down to the file's directory. */
function guardedDirectories(cwd: string, abs: string) {
  const directories: string[] = [];
  let parent = dirname(abs);
  for (;;) {
    directories.unshift(parent);
    if (parent === cwd) break;
    const next = dirname(parent);
    if (next === parent) throw new Error("Path is outside the checkout");
    parent = next;
  }
  return directories;
}

export function createRevertGuardSession(cwd: string): RevertGuardSession {
  if (process.platform !== "win32")
    return {
      async acquire() {
        return { check() {}, async release() {} };
      },
      async close() {},
    };
  let current: GuardHelper | undefined;
  return {
    async acquire(abs) {
      const directories = guardedDirectories(cwd, abs);
      // A timed-out or crashed helper is replaced; the next file starts a fresh one.
      const running = current && !current.closed ? current : undefined;
      const helper = running ?? (current = new GuardHelper());
      helper.send(JSON.stringify({ directories, path: abs }) + "\n");
      // A new helper also starts PowerShell and compiles the native handle bindings.
      const reply = await helper.nextWithin(running ? GUARD_TIMEOUT_MS : GUARD_STARTUP_TIMEOUT_MS);
      if (reply !== "READY") {
        if (reply === null) {
          await helper.completion;
          if (helper.failure) throw helper.failure;
          throw new Error(
            "File is open for writing or its directory is busy" +
              (helper.detail ? `: ${helper.detail.trim()}` : ""),
          );
        }
        throw new Error(
          "File is open for writing or its directory is busy" +
            (reply.startsWith("FAILED ") ? `: ${reply.slice(7).trim()}` : ""),
        );
      }
      return {
        check() {
          if (helper.closed) throw new Error("File guard exited during revert");
        },
        async release() {
          if (helper.closed) return;
          helper.send("\n");
          // RELEASED means every handle is closed; null means the helper is gone.
          await helper.next();
        },
      };
    },
    async close() {
      const helper = current;
      current = undefined;
      if (!helper || helper.closed) return;
      helper.child.stdin.end();
      await helper.completion;
    },
  };
}

/** One-shot guard for a single path (one helper process). */
export async function acquireRevertFileGuard(cwd: string, abs: string) {
  const session = createRevertGuardSession(cwd);
  let guard: RevertFileGuard;
  try {
    guard = await session.acquire(abs);
  } catch (error) {
    await session.close();
    throw error;
  }
  return {
    check: () => guard.check(),
    async release() {
      try {
        await guard.release();
      } finally {
        await session.close();
      }
    },
  };
}
