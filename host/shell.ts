import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { SHELL_TIMEOUT_MS, type ShellResult } from "../src/features/sessions/model/shellRun";
import { resolveShellProfile, shellInvocation, type ShellProfile } from "./shellProfiles";

/** Far above what a transcript keeps; bounds what one command can hold in memory. */
const MAX_CAPTURED = 512 * 1024;

/**
 * Runs a `!command` a user typed in a session of this machine, in that user's
 * shell, and resolves with what it printed. It never rejects: a command that
 * cannot start reports why as its output.
 */
export function runHostShell(
  cwd: string,
  command: string,
  timeoutMs = SHELL_TIMEOUT_MS,
  profile: ShellProfile | undefined = resolveShellProfile(),
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    // The shell chosen for this machine (Settings > Terminal on its desktop
    // app, or from another machine's), as a login shell: the host service
    // starts with a bare PATH.
    const invocation = profile
      ? shellInvocation(profile, command)
      : {
          file: windows ? "powershell.exe" : "/bin/sh",
          args: windows ? ["-NoProfile", "-Command", command] : ["-lc", command],
          env: {},
          verbatim: false,
        };
    let child;
    try {
      child = spawn(invocation.file, invocation.args, {
        cwd,
        env: { ...process.env, ...invocation.env },
        windowsVerbatimArguments: invocation.verbatim,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // Its own process group, so a timeout reaches what the command started.
        detached: !windows,
      });
    } catch (error) {
      resolve({
        output: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let timedOut = false;
    let settled = false;
    const keep = (current: string, chunk: string) => {
      const next = current + chunk;
      // Keep the end, where a failing command says why.
      return next.length > MAX_CAPTURED ? next.slice(-MAX_CAPTURED) : next;
    };
    child.stdout.on("data", (chunk: Buffer) => (stdout = keep(stdout, stdoutDecoder.write(chunk))));
    child.stderr.on("data", (chunk: Buffer) => (stderr = keep(stderr, stderrDecoder.write(chunk))));
    const kill = () => {
      if (windows) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        }).on("error", () => child.kill());
        return;
      }
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    timer.unref?.();
    const finish = (exitCode: number | null, failure?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout = keep(stdout, stdoutDecoder.end());
      stderr = keep(stderr, stderrDecoder.end());
      const tail = failure ?? stderr;
      const output =
        tail.trim() && stdout && !stdout.endsWith("\n")
          ? `${stdout}\n${tail}`
          : stdout + (tail.trim() ? tail : "");
      resolve({ output, exitCode: timedOut ? null : exitCode, timedOut });
    };
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
  });
}
