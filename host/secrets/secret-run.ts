import { spawn } from "node:child_process";

/** Raw capture per stream; larger than the reported limit so redaction sees whole values. */
export const RAW_CAPTURE_BYTES = 128 * 1024;
export const OUTPUT_LIMIT_BYTES = 64 * 1024;
const KILL_GRACE_MS = 3_000;

export type RawRunResult = {
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** True when the stream produced more than the raw capture holds. */
  truncated: boolean;
};

const decode = (chunks: Buffer[]) =>
  new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));

/** Keeps at most `limit` UTF-8 bytes; a split character becomes a replacement character. */
export function limitBytes(
  text: string,
  limit = OUTPUT_LIMIT_BYTES,
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return { text, truncated: false };
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, limit)),
    truncated: true,
  };
}

function killTree(pid: number | undefined, fallback: () => void): void {
  if (!pid) return fallback();
  if (process.platform === "win32") {
    const helper = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const deadline = setTimeout(() => helper.kill(), 5_000);
    helper.on("error", () => {
      clearTimeout(deadline);
      fallback();
    });
    helper.on("close", () => clearTimeout(deadline));
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    fallback();
  }
}

/** Runs one shell command with a deadline. Never rejects; a command that cannot start reports
 * a generic failure (the message could echo environment values, so it is dropped). */
export function runShellCommand(options: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<RawRunResult> {
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hard: ReturnType<typeof setTimeout> | undefined;
    let child: ReturnType<typeof spawn>;
    const finish = (exitCode: number | null, signal?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hard);
      resolve({
        exitCode,
        ...(signal ? { signal } : {}),
        timedOut,
        stdout: decode(out),
        stderr: decode(err),
        truncated,
      });
    };
    try {
      child = spawn(
        windows ? "powershell.exe" : "/bin/sh",
        windows
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `${options.command}
if ($LASTEXITCODE) { exit $LASTEXITCODE }`,
            ]
          : ["-c", options.command],
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          detached: !windows,
        },
      );
    } catch {
      resolve({
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "Command could not start.",
        truncated: false,
      });
      return;
    }
    const collect =
      (chunks: Buffer[], size: () => number, add: (n: number) => void) => (chunk: Buffer) => {
        const room = RAW_CAPTURE_BYTES - size();
        if (room <= 0) {
          truncated = true;
          return;
        }
        const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
        if (part.length < chunk.length) truncated = true;
        chunks.push(part);
        add(part.length);
      };
    child.stdout?.on(
      "data",
      collect(
        out,
        () => outBytes,
        (n) => (outBytes += n),
      ),
    );
    child.stderr?.on(
      "data",
      collect(
        err,
        () => errBytes,
        (n) => (errBytes += n),
      ),
    );
    child.stdout?.on("error", () => undefined);
    child.stderr?.on("error", () => undefined);
    child.on("error", () => {
      err.push(Buffer.from("Command could not start."));
      finish(null);
    });
    child.on("close", (code, signal) => finish(code, signal ?? undefined));
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => child.kill());
      // A grandchild may keep the pipes open after the tree kill; do not wait for it.
      hard = setTimeout(() => finish(null, "SIGKILL"), KILL_GRACE_MS);
    }, options.timeoutMs);
  });
}
