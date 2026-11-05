import { execFile } from "node:child_process";

export type DesktopRunner = (
  binary: string,
  args: string[],
  options: { signal: AbortSignal; timeoutMs: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; exitCode: number }>;

export const nativeRun: DesktopRunner = (binary, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        windowsHide: true,
        shell: false,
        signal: options.signal,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        env: options.env,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error && typeof error.code !== "number")
          return reject(new Error("Desktop helper did not return a complete result."));
        resolve({ stdout, exitCode: typeof error?.code === "number" ? error.code : 0 });
      },
    );
  });
