import { spawn, type ChildProcess } from "node:child_process";
import { elapsedSince, monotonicNow } from "../../../src/shared/lib/time/timestamps";
import { resolveShellProfile, shellInvocation } from "../../execution/shellProfiles";

const TERMINATION_GRACE_MS = 5000;
export const COMMAND_TAIL_BYTES = 64 * 1024;
export const COMMAND_DEFAULT_TIMEOUT_SECONDS = 120;
export const COMMAND_MAX_TIMEOUT_SECONDS = 1800;

/** Host credentials must not reach a model-chosen process, nor its output. */
const SECRET_ENV = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;
export function commandEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const env = { ...source };
  for (const name of Object.keys(env)) if (SECRET_ENV.test(name)) delete env[name];
  return env;
}

export type CommandStatus = "running" | "completed" | "timed-out" | "cancelled" | "failed";
export type CommandSnapshot = {
  status: CommandStatus;
  /** Null until the process exits, and after a timeout, cancellation or failed start. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  error?: string;
};
export type CommandSpec = {
  command: string;
  /** Present: run `command` directly without a shell. Absent: `command` is a shell line. */
  args?: string[];
  cwd: string;
  timeoutMs: number;
};
export type RunningCommand = {
  snapshot(): CommandSnapshot;
  /** Settles when the process has exited and its tree was asked to stop. */
  done: Promise<CommandSnapshot>;
  cancel(): void;
};

/** Keeps only the last `capacity` bytes. Decoding is lossy, so one invalid byte never ends it. */
class Tail {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  constructor(private readonly capacity: number) {}
  push(chunk: Buffer) {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.capacity) {
      const over = this.size - this.capacity;
      const first = this.chunks[0];
      if (first.length <= over) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.subarray(over);
        this.size -= over;
      }
      this.truncated = true;
    }
  }
  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    })
      .on("error", () => child.kill())
      .unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Starts one process with a deadline and bounded stdout/stderr tails. It never rejects. */
export function startCommand(
  spec: CommandSpec,
  options: { tailBytes?: number; shell?: ReturnType<typeof resolveShellProfile> } = {},
): RunningCommand {
  const startedAt = monotonicNow();
  const stdout = new Tail(options.tailBytes ?? COMMAND_TAIL_BYTES);
  const stderr = new Tail(options.tailBytes ?? COMMAND_TAIL_BYTES);
  let status: CommandStatus = "running";
  let exitCode: number | null = null;
  let error: string | undefined;
  let durationMs = 0;
  let child: ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  /** A deadline or cancel asked the tree to stop; the status settles when the process exits. */
  let ending: { status: CommandStatus; message: string } | undefined;
  let settle!: (value: CommandSnapshot) => void;
  const done = new Promise<CommandSnapshot>((resolve) => (settle = resolve));
  const snapshot = (): CommandSnapshot => ({
    status,
    exitCode,
    stdout: stdout.text(),
    stderr: stderr.text(),
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    durationMs: status === "running" ? elapsedSince(startedAt) : durationMs,
    ...(error ? { error } : {}),
  });
  const finish = (next: CommandStatus, code: number | null, message?: string) => {
    if (status !== "running") return;
    status = next;
    exitCode = code;
    error = message;
    durationMs = elapsedSince(startedAt);
    clearTimeout(timer);
    clearTimeout(grace);
    settle(snapshot());
  };
  const stop = (next: CommandStatus, message: string) => {
    if (status !== "running" || ending || !child) return;
    ending = { status: next, message };
    killTree(child);
    // Bounded: a tree that cannot be stopped is reported as unconfirmed, never as stopped.
    grace = setTimeout(
      () => finish(next, null, `${message} Termination was not confirmed.`),
      TERMINATION_GRACE_MS,
    );
    grace.unref?.();
  };
  try {
    const windows = process.platform === "win32";
    const invocation = spec.args
      ? { file: spec.command, args: spec.args, env: {}, verbatim: false }
      : (() => {
          const profile = options.shell ?? resolveShellProfile();
          if (profile) return shellInvocation(profile, spec.command);
          return {
            file: windows ? "powershell.exe" : "/bin/sh",
            args: windows ? ["-NoProfile", "-Command", spec.command] : ["-lc", spec.command],
            env: {},
            verbatim: false,
          };
        })();
    child = spawn(invocation.file, invocation.args, {
      cwd: spec.cwd,
      env: { ...commandEnvironment(), ...invocation.env },
      windowsVerbatimArguments: invocation.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      // Its own process group, so a deadline or cancel reaches what the command started.
      detached: !windows,
    });
  } catch (cause) {
    finish("failed", null, cause instanceof Error ? cause.message : String(cause));
    return { snapshot, done, cancel: () => {} };
  }
  const process_ = child;
  process_.stdout?.on("data", (chunk: Buffer) => status === "running" && stdout.push(chunk));
  process_.stderr?.on("data", (chunk: Buffer) => status === "running" && stderr.push(chunk));
  process_.on("error", (cause) => finish("failed", null, cause.message));
  process_.on("close", (code) =>
    ending ? finish(ending.status, null, ending.message) : finish("completed", code),
  );
  timer = setTimeout(
    () => stop("timed-out", "The command exceeded its deadline and its process tree was stopped."),
    spec.timeoutMs,
  );
  timer.unref?.();
  return {
    snapshot,
    done,
    cancel: () => stop("cancelled", "The command was cancelled and its process tree was stopped."),
  };
}
