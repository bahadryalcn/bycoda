import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Folder of the running Host package; host.mjs and `bin/` sit side by side in it. */
const hostFolder = () => dirname(fileURLToPath(import.meta.url));

/** `<host folder>/bin`, where packaging places the pinned bykit binary. */
export const bundledBykitDirectory = (folder = hostFolder()) => join(folder, "bin");

/** Absolute path of the bundled bykit binary, or undefined when this Host does not ship one. */
export function bundledBykitPath(
  folder = hostFolder(),
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const path = join(bundledBykitDirectory(folder), platform === "win32" ? "bykit.exe" : "bykit");
  return existsSync(path) ? path : undefined;
}

/** The bykit version recorded in `version.json` at packaging time, if any. */
export function bundledBykitVersion(folder = hostFolder()): string | undefined {
  if (!bundledBykitPath(folder)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(folder, "version.json"), "utf8"));
    const version = (parsed as { bykitVersion?: unknown } | null)?.bykitVersion;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts the bundled bykit first on PATH so it wins over a user-installed one. Windows
 * names the variable `Path`, other systems `PATH`; the existing key is kept so the
 * child never sees two spellings. Returns the environment unchanged without a bundle.
 */
export function withBundledBykit<T extends NodeJS.ProcessEnv>(
  env: T,
  folder = hostFolder(),
  platform: NodeJS.Platform = process.platform,
): T {
  if (!bundledBykitPath(folder, platform)) return env;
  const directory = bundledBykitDirectory(folder);
  const keys = Object.keys(env).filter(
    (key) => (platform === "win32" ? key.toUpperCase() : key) === "PATH",
  );
  const key = keys[0] ?? (platform === "win32" ? "Path" : "PATH");
  const separator = platform === "win32" ? ";" : ":";
  const current = keys.map((name) => env[name]).find((value) => value) ?? "";
  for (const name of keys.slice(1)) delete env[name];
  (env as NodeJS.ProcessEnv)[key] = current ? `${directory}${separator}${current}` : directory;
  return env;
}
