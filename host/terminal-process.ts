import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { windowsUtf8ConsoleSetup, type ShellProfile } from "./execution/shellProfiles";

export type OwnedTerminalProcess = {
  write(data: string): Promise<void>;
  stop(): Promise<void>;
};

/** Input written before the first user command; empty where the shell needs no setup. */
export function terminalStartupInput(
  kind: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const setup = windowsUtf8ConsoleSetup(kind, platform);
  return setup ? `${setup}\r\n` : "";
}

/** One child shell owns the command and its actual exit status; output cannot forge completion. */
export function terminalCommandArgs(
  kind: string,
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const setup = windowsUtf8ConsoleSetup(kind, platform);
  if (kind === "pwsh" || kind === "powershell")
    return [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      setup ? `${setup};\n${command}` : command,
    ];
  if (["sh", "bash", "zsh", "git-bash"].includes(kind)) return ["-c", command];
  throw new Error("Command execution is unsupported for this terminal shell");
}

/** Use the existing watchdog guardian: only its owned child's tree can be stopped. */
export function startTerminalProcess(
  profile: ShellProfile,
  cwd: string,
  output: (data: string) => void,
  exit: (code: number | null) => void,
  command?: string,
): OwnedTerminalProcess {
  const args =
    command !== undefined
      ? terminalCommandArgs(profile.kind, command)
      : profile.kind === "pwsh" || profile.kind === "powershell"
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
      stdio: ["pipe", "pipe", "pipe", "pipe", command === undefined ? "ignore" : "ipc"],
      detached: process.platform !== "win32",
      windowsHide: true,
      shell: false,
    },
  ) as ChildProcessWithoutNullStreams;
  let ended = false;
  let pending = false;
  let stopPromise: Promise<void> | undefined;
  const stdout = new StringDecoder("utf8");
  const stderr = new StringDecoder("utf8");
  child.stdout.on("data", (chunk: Buffer) => output(stdout.write(chunk)));
  child.stderr.on("data", (chunk: Buffer) => output(stderr.write(chunk)));
  child.stdin.on("error", () => {});
  if (command !== undefined)
    child.on("message", (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        !("type" in message) ||
        message.type !== "child-exited"
      )
        return;
      const watchdog = child.stdio[3];
      if (watchdog && "end" in watchdog) watchdog.end();
    });
  // Queued ahead of any user input, so the first command already runs in UTF-8.
  const startup = command === undefined ? terminalStartupInput(profile.kind) : "";
  if (startup) child.stdin.write(startup, "utf8");
  const complete = (code: number | null) => {
    if (ended) return;
    ended = true;
    output(stdout.end());
    output(stderr.end());
    exit(code);
  };
  // An error after spawn does not prove that the child has exited. Node emits
  // close after spawn failure too, so keep ownership until that event.
  child.once("error", () => {});
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
