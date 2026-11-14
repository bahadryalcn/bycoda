import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { DesktopRunner } from "./desktop-control-runner";

const APP_PATHS = "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths";

/** The pinned helper launches a bare Windows name only from System32 or the Windows folder.
 * Installed apps (Chrome, Edge, VS Code) register their executable under "App Paths"; resolve
 * a bare name there to an absolute path. Returns undefined when nothing is registered, and the
 * helper then reports its own APP_NOT_FOUND. */
export async function resolveWindowsAppPath(
  app: string,
  run: DesktopRunner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const name = app.trim();
  if (!name || isAbsolute(name) || /[\\/:"]/.test(name)) return undefined;
  const executable = /\.exe$/i.test(name) ? name : `${name}.exe`;
  const windows = env.SystemRoot ?? env.windir ?? "C:\\Windows";
  // The helper already launches these itself; keep its own resolution.
  for (const dir of [join(windows, "System32"), windows])
    if (await isFile(join(dir, executable))) return undefined;
  const reg = join(windows, "System32", "reg.exe");
  for (const hive of ["HKCU", "HKLM"]) {
    let stdout: string;
    try {
      const result = await run(reg, ["query", `${hive}\\${APP_PATHS}\\${executable}`, "/ve"], {
        signal: AbortSignal.timeout(5000),
        timeoutMs: 5000,
        maxBuffer: 64 * 1024,
        env,
      });
      if (result.exitCode !== 0) continue;
      stdout = result.stdout;
    } catch {
      continue;
    }
    const path = parseRegDefaultValue(stdout, env);
    if (!path || !isAbsolute(path) || !/\.exe$/i.test(path)) continue;
    // A stale registration points at a removed install; try the next hive.
    if (await isFile(path)) return path;
  }
  return undefined;
}

const isFile = (path: string) =>
  stat(path).then(
    (details) => details.isFile(),
    () => false,
  );

/** The "(Default)" label is localized, so match the value type instead of the name. */
export function parseRegDefaultValue(stdout: string, env: NodeJS.ProcessEnv = process.env) {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /\s(REG_SZ|REG_EXPAND_SZ)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].replace(/^"(.*)"$/, "$1");
    if (match[1] === "REG_EXPAND_SZ")
      value = value.replace(/%([^%]+)%/g, (whole, key: string) => {
        const found = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase());
        return found ? (env[found] ?? whole) : whole;
      });
    return value;
  }
  return undefined;
}
