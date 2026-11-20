import { spawn, type ChildProcess } from "node:child_process";

/** After a kill signal, wait this long for a graceful exit before SIGKILL and giving up. */
const KILL_GRACE_MS = 2000;
/** After `exit`, wait this long for buffered output before a leaked pipe holder is ignored. */
const EXIT_DRAIN_MS = 500;

/** Hidden, argument-array-only subprocess. Hard time and output bounds. */
export function deviceCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string> {
  return deviceBinaryCommand(command, args, { ...options, maxBytes: 1024 * 1024 }).then((output) =>
    output.toString("utf8"),
  );
}

/** Preserve screenshot bytes; text decoding corrupts PNG output from adb exec-out. */
export function deviceBinaryCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { maxBytes = 4 * 1024 * 1024, ...processOptions } = options;
    const child = spawn(command, args, {
      ...processOptions,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let diagnostic = "";
    let bytes = 0;
    let failure: Error | undefined;
    let settled = false;
    const timers = new Set<NodeJS.Timeout>();
    const later = (action: () => void, ms: number) => {
      const timer = setTimeout(action, ms);
      timers.add(timer);
    };
    // `close` waits for every stdio pipe, so a grandchild that inherited them
    // (adb's background server) or a tool that ignores SIGTERM would never
    // settle this promise. Every path funnels here and frees the pipes.
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish();
    };
    const fail = (error: Error) => {
      failure ??= error;
      child.kill();
      later(() => {
        child.kill("SIGKILL");
        settle(() => reject(failure));
      }, KILL_GRACE_MS);
    };
    const exitResult = (code: number | null) => {
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `Device command failed (${code}): ${diagnostic || Buffer.concat(output).toString("utf8").slice(-2000)}`,
          ),
        );
      else resolve(Buffer.concat(output));
    };
    later(() => fail(new Error("Device command timed out")), options.timeoutMs ?? 30_000);
    const collect = (chunk: Buffer, stderr: boolean) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new Error(`Device command output exceeds ${maxBytes / (1024 * 1024)} MiB`));
      } else if (stderr) diagnostic = `${diagnostic}${chunk.toString()}`.slice(-2000);
      else output.push(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, false));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, true));
    child.once("error", (error) => settle(() => reject(error)));
    child.once("exit", (code) => {
      if (failure) settle(() => reject(failure));
      else later(() => settle(() => exitResult(code)), EXIT_DRAIN_MS);
    });
    child.once("close", (code) => settle(() => exitResult(code)));
  });
}
export async function stopDeviceChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}
