import { access, constants } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join } from "node:path";

/** How a hub child is spawned: a resolved executable, or a Windows `.cmd`/`.bat` shim. */
export type HubLaunch = {
  command: string;
  args: string[];
  /** Set only for `.cmd`/`.bat` shims, which Windows cannot exec directly. */
  shell?: { command: string; args: string[]; windowsVerbatimArguments: true };
};

const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds a bare command on PATH the way the shell would (PATHEXT on Windows). */
export async function resolveOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (isAbsolute(command) || /[\\/]/.test(command)) return command;
  const windows = platform === "win32";
  const directories = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const extensions = windows && !extname(command) ? WINDOWS_EXTENSIONS : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory.replace(/^"|"$/g, ""), command + extension);
      if (await exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Quotes one argument for cmd.exe's `/s /c` command line. */
function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Inherited user definitions use bare commands (`npx`, `uvx`). Node cannot exec a
 * Windows `.cmd`/`.bat` shim without a shell, so those run through `cmd.exe /d /s /c`
 * with every argument quoted; everything else spawns directly, as before.
 */
export async function resolveHubLaunch(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<HubLaunch> {
  const resolved = (await resolveOnPath(command, env, platform)) ?? command;
  const plain = { command: resolved, args: [...args] };
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(resolved)) return plain;
  const line = [resolved, ...args].map(quoteForCmd).join(" ");
  return {
    ...plain,
    shell: {
      command: env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `"${line}"`],
      windowsVerbatimArguments: true,
    },
  };
}
