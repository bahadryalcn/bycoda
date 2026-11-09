import { type ChildProcess, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type CommandResult = { code: number; stdout: string };

const DEFAULT_OUTPUT_CHARS = 256_000;

/**
 * Runs a fixed external command with a deadline. Output is decoded leniently, so one invalid
 * byte never ends the read. A timeout or abort kills the process tree and resolves undefined.
 */
export function runCommand(
  file: string,
  args: readonly string[],
  options: { timeoutMs: number; signal?: AbortSignal; maxOutputChars?: number },
): Promise<CommandResult | undefined> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve(undefined);
      return;
    }
    const decoder = new StringDecoder("utf8");
    const limit = options.maxOutputChars ?? DEFAULT_OUTPUT_CHARS;
    let output = "";
    let settled = false;
    let child: ChildProcess;
    const finish = (value?: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("error", () => child.kill());
      } else child.kill();
    };
    const abort = () => {
      kill();
      finish();
    };
    try {
      child = spawn(file, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      kill();
      finish();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      output = (output + decoder.write(chunk)).slice(-limit);
    });
    child.on("error", () => finish());
    child.on("close", (code) => {
      output += decoder.end();
      finish(code === 0 ? { code, stdout: output } : undefined);
    });
  });
}
