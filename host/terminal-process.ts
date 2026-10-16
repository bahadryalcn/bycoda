import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import type { ShellProfile } from "./shellProfiles";

export type OwnedTerminalProcess = {
  write(data: string): Promise<void>;
  stop(): Promise<void>;
};

/** Use the existing watchdog guardian: only its owned child's tree can be stopped. */
export function startTerminalProcess(
  profile: ShellProfile,
  cwd: string,
  output: (data: string) => void,
  exit: (code: number | null) => void,
): OwnedTerminalProcess {
  const args =
    profile.kind === "pwsh" || profile.kind === "powershell"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"]
      : profile.kind === "cmd"
        ? ["/D", "/Q"]
        : profile.kind === "wsl"
          ? ["--exec", "sh"]
          : [];
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./provider-guard.mjs", import.meta.url)), profile.path, ...args],
    {
      cwd,
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1", BYCODA_HOST: "1" },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
      shell: false,
    },
  );
  let ended = false;
  let pending = false;
  let stopPromise: Promise<void> | undefined;
  const stdout = new StringDecoder("utf8");
  const stderr = new StringDecoder("utf8");
  child.stdout.on("data", (chunk: Buffer) => output(stdout.write(chunk)));
  child.stderr.on("data", (chunk: Buffer) => output(stderr.write(chunk)));
  child.stdin.on("error", () => {});
  const complete = (code: number | null) => {
    if (ended) return;
    ended = true;
    output(stdout.end());
    output(stderr.end());
    exit(code);
  };
  child.once("error", () => complete(null));
  child.once("close", (code) => complete(code));
  return {
    write(data) {
      if (ended || stopPromise)
        return Promise.reject(new Error("Terminal has exited or is stopping"));
      if (pending)
        return Promise.reject(new Error("Terminal input is busy; wait for the previous write"));
      pending = true;
      return new Promise<void>((resolve, reject) => {
        // A timed-out write may already have reached the shell. It is never replayed.
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Terminal write outcome is unknown; read output before sending more input. Do not retry automatically.",
              ),
            ),
          5_000,
        );
        child.stdin.write(data, "utf8", (error) => {
          clearTimeout(timeout);
          pending = false;
          if (error)
            reject(new Error("Terminal write outcome is unknown; inspect output before retrying."));
          else resolve();
        });
      });
    },
    stop() {
      if (ended) return Promise.resolve();
      if (stopPromise) return stopPromise;
      stopPromise = new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          child.off("close", done);
          stopPromise = undefined;
          reject(new Error("Terminal stop was not confirmed; inspect its state before retrying"));
        }, 7_000);
        child.once("close", done);
        // EOF on the guard's private watchdog triggers its process-tree shutdown.
        const watchdog = child.stdio[3];
        if (watchdog && "end" in watchdog) watchdog.end();
      });
      return stopPromise;
    },
  };
}
