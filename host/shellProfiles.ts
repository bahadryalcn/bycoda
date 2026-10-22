import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/**
 * The shells this machine can run a `!command` in, listed and chosen the same
 * way as the desktop app's terminal profiles (src-tauri terminal_profiles.rs),
 * so a session runs commands alike whichever machine they were typed on.
 */
export type ShellProfile = { id: string; name: string; path: string; kind: string };

export type ShellProfiles = {
  profiles: ShellProfile[];
  defaultId: string | null;
  chosenId: string | null;
};

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir.replace(/^"|"$/g, ""), name);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function detectWindows(): ShellProfile[] {
  const found: ShellProfile[] = [];
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const system32 = join(systemRoot, "System32");
  const programDirs = ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]
    .map((key) => process.env[key])
    .filter((dir): dir is string => !!dir);

  const pwsh =
    onPath("pwsh.exe") ??
    programDirs.map((dir) => join(dir, "PowerShell", "7", "pwsh.exe")).find(isFile);
  if (pwsh) found.push({ id: "pwsh", name: "PowerShell 7", path: pwsh, kind: "pwsh" });

  const powershell = join(system32, "WindowsPowerShell", "v1.0", "powershell.exe");
  if (isFile(powershell))
    found.push({
      id: "powershell",
      name: "Windows PowerShell",
      path: powershell,
      kind: "powershell",
    });

  const cmd =
    process.env.COMSPEC && isFile(process.env.COMSPEC)
      ? process.env.COMSPEC
      : join(system32, "cmd.exe");
  if (isFile(cmd)) found.push({ id: "cmd", name: "Command Prompt", path: cmd, kind: "cmd" });

  // Git for Windows' bash, never System32\bash.exe (WSL's launcher).
  const git = onPath("git.exe");
  const besideGit = git
    ? [dirname(dirname(git)), dirname(dirname(dirname(git)))].map((root) =>
        join(root, "bin", "bash.exe"),
      )
    : [];
  const local = process.env.LOCALAPPDATA
    ? [join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")]
    : [];
  const bash = [
    ...besideGit,
    ...programDirs.map((dir) => join(dir, "Git", "bin", "bash.exe")),
    ...local,
  ].find(isFile);
  if (bash) found.push({ id: "git-bash", name: "Git Bash", path: bash, kind: "bash" });

  const wsl = join(system32, "wsl.exe");
  if (isFile(wsl)) found.push({ id: "wsl", name: "WSL", path: wsl, kind: "wsl" });
  return found;
}

/** Login shells that run one command line with `-c`. */
const UNIX_SHELLS = new Set([
  "sh",
  "bash",
  "rbash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "mksh",
  "oksh",
  "yash",
  "csh",
  "tcsh",
]);

function detectUnix(): ShellProfile[] {
  const paths: string[] = [];
  if (process.env.SHELL) paths.push(process.env.SHELL);
  try {
    for (const line of readFileSync("/etc/shells", "utf8").split("\n")) {
      const path = line.trim();
      if (path.startsWith("/")) paths.push(path);
    }
  } catch {
    /* no /etc/shells */
  }
  paths.push("/bin/zsh", "/bin/bash", "/bin/sh");
  const found: ShellProfile[] = [];
  for (const path of paths) {
    if (!isFile(path) || found.some((entry) => entry.path === path)) continue;
    const stem =
      path
        .split("/")
        .pop()!
        .replace(/\.[^.]*$/, "") || "sh";
    // /etc/shells also lists terminal multiplexers such as screen and tmux.
    if (!UNIX_SHELLS.has(stem)) continue;
    const kind = ["zsh", "bash", "fish"].includes(stem)
      ? stem
      : stem === "csh" || stem === "tcsh"
        ? "csh"
        : "sh";
    const name = found.some((entry) => entry.name === stem) ? `${stem} (${path})` : stem;
    found.push({ id: path, name, path, kind });
  }
  return found;
}

export function detectShellProfiles(): ShellProfile[] {
  return process.platform === "win32" ? detectWindows() : detectUnix();
}

function defaultProfile(profiles: ShellProfile[]): ShellProfile | undefined {
  if (process.platform === "win32")
    return (
      ["pwsh", "powershell", "cmd"]
        .map((id) => profiles.find((profile) => profile.id === id))
        .find(Boolean) ?? profiles[0]
    );
  return profiles.find((profile) => profile.path === process.env.SHELL) ?? profiles[0];
}

/** Shared with the desktop app on this machine (`set_terminal_profile`). */
export function choicePath(home = homedir()): string {
  return join(home, ".bycoda-host", "terminal-profile.json");
}

export function chosenProfileId(path = choicePath()): string | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { profile?: unknown };
    return typeof value.profile === "string" && value.profile.trim() ? value.profile.trim() : null;
  } catch {
    return null;
  }
}

export function setChosenProfile(id: string | null, path = choicePath()): void {
  if (!id) {
    if (existsSync(path)) rmSync(path, { force: true });
    return;
  }
  if (!detectShellProfiles().some((profile) => profile.id === id))
    throw new Error("That shell is not installed on this machine");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ profile: id }));
}

export function listShellProfiles(path = choicePath()): ShellProfiles {
  const profiles = detectShellProfiles();
  return {
    profiles,
    defaultId: defaultProfile(profiles)?.id ?? null,
    chosenId: chosenProfileId(path),
  };
}

/** Compare the single saved preference before a remotely reviewed update. */
export function setReviewedProfile(input: Record<string, unknown>, path = choicePath()): ShellProfiles {
  const valid = (value: unknown): value is string | null => value === null || typeof value === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(value);
  if (Object.keys(input).some((key) => !["profile", "expectedChosenId"].includes(key)) || !valid(input.profile) || !valid(input.expectedChosenId))
    throw new Error("Invalid reviewed shell preference");
  if (chosenProfileId(path) !== input.expectedChosenId)
    throw new Error("The command shell preference changed. Refresh and review again.");
  setChosenProfile(input.profile, path);
  return listShellProfiles(path);
}

/** The chosen profile while its shell is installed, else the system default. */
export function resolveShellProfile(path = choicePath()): ShellProfile | undefined {
  const profiles = detectShellProfiles();
  const chosen = chosenProfileId(path);
  return (
    (chosen ? profiles.find((profile) => profile.id === chosen) : undefined) ??
    defaultProfile(profiles)
  );
}

/** How to run one command line in `profile`. */
export function shellInvocation(
  profile: ShellProfile,
  line: string,
): {
  file: string;
  args: string[];
  env: Record<string, string>;
  /** cmd parses its own command line; Node must not quote it. */
  verbatim: boolean;
} {
  switch (profile.kind) {
    case "powershell":
    case "pwsh":
      return {
        file: profile.path,
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${line}`,
        ],
        env: {},
        verbatim: false,
      };
    case "cmd":
      return { file: profile.path, args: ["/d", "/s", "/c", `"${line}"`], env: {}, verbatim: true };
    case "wsl":
      return { file: profile.path, args: ["-e", "bash", "-lc", line], env: {}, verbatim: false };
    case "csh":
      // csh and tcsh accept -l only as their sole argument.
      return { file: profile.path, args: ["-c", line], env: {}, verbatim: false };
    default:
      return {
        file: profile.path,
        args: ["-lc", line],
        // Git Bash's login profile changes to the home folder unless told to stay.
        env: process.platform === "win32" ? { CHERE_INVOKING: "1", MSYSTEM: "MINGW64" } : {},
        verbatim: false,
      };
  }
}
