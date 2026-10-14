import { spawn, type ChildProcess } from "node:child_process";

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
    const timer = setTimeout(() => {
      failure = new Error("Device command timed out");
      child.kill();
    }, options.timeoutMs ?? 30_000);
    const collect = (chunk: Buffer, stderr: boolean) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        failure = new Error(`Device command output exceeds ${maxBytes / (1024 * 1024)} MiB`);
        child.kill();
      } else if (stderr) diagnostic = `${diagnostic}${chunk.toString()}`.slice(-2000);
      else output.push(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, false));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, true));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `Device command failed (${code}): ${diagnostic || Buffer.concat(output).toString("utf8").slice(-2000)}`,
          ),
        );
      else resolve(Buffer.concat(output));
    });
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
