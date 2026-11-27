import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { windowsUtf8ConsoleSetup, type ShellProfile } from "../execution/shellProfiles";
import type { OwnedTerminalProcess } from "../terminal-process";

type PtyModule = typeof import("@lydell/node-pty");
type Pty = ReturnType<PtyModule["spawn"]>;

export const PTY_DEFAULT_SIZE = { cols: 80, rows: 24 };
const STOP_TIMEOUT_MS = 7_000;

/** Thrown before any spawn, so the caller knows no shell was started. */
export class PtyUnavailableError extends Error {
  constructor() {
    super("Interactive terminals are unavailable on this Host install");
  }
}

let loaded: PtyModule | null | undefined;
/** The native PTY binding, or null when this Host install has none for its platform. */
export function loadPtyModule(): PtyModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // Native addon: esbuild keeps it external, so it resolves from the Host's node_modules.
    loaded = createRequire(import.meta.url)("@lydell/node-pty") as PtyModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Interactive shell arguments, matching the desktop PTY. Windows shells start in UTF-8 silently. */
export function ptyShellArgs(kind: string, platform: NodeJS.Platform = process.platform): string[] {
  const setup = windowsUtf8ConsoleSetup(kind, platform);
  if (kind === "pwsh" || kind === "powershell")
    return setup ? ["-NoLogo", "-NoExit", "-Command", setup] : ["-NoLogo"];
  if (kind === "cmd") return setup ? ["/D", "/K", setup] : ["/D"];
  if (kind === "bash" && platform === "win32") return ["--login", "-i"];
  if (["bash", "zsh", "sh", "fish", "csh"].includes(kind)) return ["-l"];
  return [];
}

/** A shell reads Enter as CR; agent and pasted text may end lines with LF. */
export function ptyInput(data: string): string {
  return data.replace(/\r?\n/g, "\r");
}

function ptyEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && key !== "NO_COLOR") env[key] = value;
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "bycoda",
    BYCODA_HOST: "1",
  };
}

/** Ends the shell and every process it started, then the pseudo-console itself. */
function killTree(pty: Pty, ended: () => boolean): void {
  if (process.platform === "win32") {
    // The tree first: closing the pseudo-console alone can leave detached descendants running.
    execFile("taskkill", ["/T", "/F", "/PID", String(pty.pid)], { windowsHide: true }, () => {
      if (ended()) return;
      try {
        pty.kill();
      } catch {
        /* already gone */
      }
    });
    return;
  }
  // node-pty starts the shell as a session leader: its process group holds the jobs it runs.
  for (const target of [-pty.pid, pty.pid])
    try {
      process.kill(target, "SIGHUP");
    } catch {
      /* already gone */
    }
  setTimeout(() => {
    try {
      process.kill(-pty.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }, 2_000).unref();
}

/** One interactive shell in a real pseudo-terminal: the shell owns echo, prompt, editing and jobs. */
export function startPtyProcess(
  profile: ShellProfile,
  cwd: string,
  size: { cols: number; rows: number },
  output: (data: string) => void,
  exit: (code: number | null) => void,
  module: PtyModule | null = loadPtyModule(),
): OwnedTerminalProcess {
  if (!module) throw new PtyUnavailableError();
  const pty = module.spawn(profile.path, ptyShellArgs(profile.kind), {
    name: "xterm-256color",
    cols: size.cols,
    rows: size.rows,
    cwd,
    env: ptyEnvironment(),
  });
  let ended = false;
  let stopPromise: Promise<void> | undefined;
  const closed: Array<() => void> = [];
  pty.onData((data) => {
    if (!ended) output(data);
  });
  pty.onExit(({ exitCode }) => {
    if (ended) return;
    ended = true;
    exit(exitCode);
    for (const done of closed.splice(0)) done();
  });
  const live = () => {
    if (ended || stopPromise) throw new Error("Terminal has exited or is stopping");
  };
  return {
    async write(data) {
      live();
      pty.write(ptyInput(data));
    },
    async interrupt() {
      live();
      // Ctrl-C through the line discipline (ConPTY on Windows): only the foreground program gets it.
      pty.write("\u0003");
    },
    async resize(cols, rows) {
      live();
      pty.resize(cols, rows);
    },
    stop() {
      if (ended) return Promise.resolve();
      if (stopPromise) return stopPromise;
      stopPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = closed.indexOf(done);
          if (index >= 0) closed.splice(index, 1);
          stopPromise = undefined;
          reject(new Error("Terminal stop was not confirmed; inspect its state before retrying"));
        }, STOP_TIMEOUT_MS);
        const done = () => {
          clearTimeout(timeout);
          resolve();
        };
        closed.push(done);
        killTree(pty, () => ended);
      });
      return stopPromise;
    },
  };
}
