import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { OutputBuffer } from "./output-buffer";
import {
  SHELL_TIMEOUT_MS,
  type ShellResult,
  type ShellPhysicalIdentity,
} from "../../src/features/sessions/model/shellRun";
import { resolveShellProfile, shellInvocation, type ShellProfile } from "./shellProfiles";
import { resolveSessionCwd } from "../providers/session-folder";

/** Far above what a transcript keeps; bounds what one command can hold in memory. */
const MAX_CAPTURED = 512 * 1024;
const IDENTITY_PUBLICATION_WAIT_MS = 5_000;

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
  signal?: AbortSignal,
  onTerminationFailure?: (message: string) => void,
  onPhysicalIdentity?: (identity: ShellPhysicalIdentity) => Promise<void>,
): Promise<ShellResult> {
  // A session without a project (cwd exactly `~`) runs in the chosen session folder.
  // Any other cwd spawns synchronously, as before.
  if (cwd === "~")
    return resolveSessionCwd(cwd)
      .catch(() => undefined)
      .then((resolved) => runInCwd(resolved ?? cwd));
  return runInCwd(cwd);
  function runInCwd(cwd: string): Promise<ShellResult> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve({ output: "Command cancelled.", exitCode: null, timedOut: false });
        return;
      }
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
      const stdout = new OutputBuffer(MAX_CAPTURED);
      let physicalIdentity: ShellPhysicalIdentity | undefined = child.pid
        ? { pid: child.pid, hostPid: process.pid, spawnObservedAt: Date.now() }
        : undefined;
      let identityPublication = Promise.resolve();
      const publishIdentity = () => {
        if (physicalIdentity && onPhysicalIdentity) {
          const original = Object.freeze({ ...physicalIdentity });
          identityPublication = identityPublication.then(() => onPhysicalIdentity(original));
          void identityPublication.catch(() => {});
        }
      };
      publishIdentity();
      const stderr = new OutputBuffer(MAX_CAPTURED);
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let timedOut = false;
      let settled = false;
      let terminationFailed: string | undefined;
      child.stdout.on("data", (chunk: Buffer) => {
        if (!settled) stdout.append(stdoutDecoder.write(chunk));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (!settled) stderr.append(stderrDecoder.write(chunk));
      });
      let terminating: Promise<void> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const kill = () => {
        if (terminating) return;
        if (windows) {
          terminating = new Promise<void>((done) => {
            let completed = false;
            let helper: ReturnType<typeof spawn> | undefined;
            const complete = (failure?: string) => {
              if (completed) return;
              completed = true;
              clearTimeout(deadline);
              if (failure) {
                terminationFailed = failure;
                console.error(failure);
                try {
                  void Promise.resolve(onTerminationFailure?.(failure)).catch((error) =>
                    console.error("Could not report command termination failure:", error),
                  );
                } catch (error) {
                  console.error("Could not report command termination failure:", error);
                }
              }
              done();
              if (failure) finish(null, failure);
            };
            const deadline = setTimeout(() => {
              try {
                helper?.kill("SIGKILL");
              } catch {
                /* Unknown helper retirement remains part of the held owner. */
              }
              complete("Command tree termination timed out; verification remains locked.");
            }, 5_000);
            deadline.unref?.();
            try {
              helper = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                stdio: "ignore",
                windowsHide: true,
              })
                .on("error", (error) => {
                  // Killing only the parent cannot prove its descendants stopped.
                  // Keep ownership locked rather than permit overlapping checks.
                  complete(`Could not terminate the command tree: ${error.message}`);
                })
                .on("close", (code) => {
                  if (code === 0) complete();
                  else {
                    const message = `Command tree termination failed (exit ${code}); verification remains locked.`;
                    complete(message);
                  }
                });
              if (helper.pid && physicalIdentity) {
                physicalIdentity = { ...physicalIdentity, helperPid: helper.pid };
                publishIdentity();
              }
            } catch (error) {
              complete(
                `Could not terminate the command tree: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          });
          return;
        }
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      const abort = () => kill();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      timer.unref?.();
      function finish(exitCode: number | null, failure?: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        void Promise.resolve(terminating)
          .then(async () => {
            stdout.append(stdoutDecoder.end());
            stderr.append(stderrDecoder.end());
            let publicationTimer: ReturnType<typeof setTimeout> | undefined;
            try {
              // Bound only observation. The original publication keeps its handlers
              // and may settle later; a deadline never proves persistence or retirement.
              await Promise.race([
                identityPublication,
                new Promise<never>((_, reject) => {
                  publicationTimer = setTimeout(
                    () =>
                      reject(
                        new Error(
                          "Process identity publication timed out; verification remains locked.",
                        ),
                      ),
                    IDENTITY_PUBLICATION_WAIT_MS,
                  );
                  publicationTimer.unref?.();
                }),
              ]);
            } catch (error) {
              terminationFailed ??= `The original command process identity could not be saved: ${error instanceof Error ? error.message : String(error)}`;
            } finally {
              clearTimeout(publicationTimer);
            }
            const captured = stdout.slice();
            const tail = terminationFailed ?? failure ?? stderr.slice();
            const output =
              tail.trim() && captured && !captured.endsWith("\n")
                ? `${captured}\n${tail}`
                : captured + (tail.trim() ? tail : "");
            resolve({
              output,
              exitCode: timedOut || signal?.aborted || terminationFailed ? null : exitCode,
              timedOut,
              ...(terminationFailed ? { terminationFailed, physicalIdentity } : {}),
            });
          })
          .catch(() => {
            // Even an unexpected observer/decoder failure must resolve conservatively.
            // Avoid formatting the thrown value: its own conversion can also throw.
            terminationFailed ??=
              "Command completion could not be confirmed; verification remains locked.";
            let captured = "";
            try {
              captured = stdout.slice();
            } catch {
              /* Preserve failure-to-result even if materialization failed. */
            }
            resolve({
              output: captured ? `${captured}\n${terminationFailed}` : terminationFailed,
              exitCode: null,
              timedOut,
              terminationFailed,
              physicalIdentity,
            });
          });
      }
      child.on("error", (error) => finish(null, error.message));
      child.on("close", (code) => finish(code));
    });
  }
}
