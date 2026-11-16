import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRegDefaultValue, resolveWindowsAppPath } from "./desktop-app-paths";
import type { DesktopRunner } from "./desktop-control-runner";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-app-paths-"));
  dirs.push(dir);
  return dir;
};

it("reads the default value whatever the localized label, expanding variables", () => {
  const env = { ProgramFiles: "C:\\Program Files" };
  expect(
    parseRegDefaultValue(
      "\r\nHKEY_LOCAL_MACHINE\\...\\chrome.exe\r\n    (Varsayılan)    REG_SZ    C:\\Apps\\chrome.exe\r\n",
      env,
    ),
  ).toBe("C:\\Apps\\chrome.exe");
  expect(
    parseRegDefaultValue('    (Default)    REG_EXPAND_SZ    "%programfiles%\\a.exe"', env),
  ).toBe("C:\\Program Files\\a.exe");
  expect(parseRegDefaultValue("ERROR: not found", env)).toBeUndefined();
});

it("resolves a bare name through App Paths, preferring the user hive and skipping stale entries", async () => {
  const windows = tempDir();
  const apps = join(tempDir(), "Chrome");
  mkdirSync(apps);
  const exe = join(apps, "chrome.exe");
  writeFileSync(exe, "");
  const queries: string[] = [];
  const run: DesktopRunner = async (binary, args, options) => {
    expect(binary).toBe(join(windows, "System32", "reg.exe"));
    expect(options.timeoutMs).toBeGreaterThan(0);
    queries.push(args[1]);
    return args[1].startsWith("HKCU")
      ? { stdout: `    (Default)    REG_SZ    ${join(apps, "missing.exe")}`, exitCode: 0 }
      : { stdout: `    (Default)    REG_SZ    ${exe}`, exitCode: 0 };
  };
  expect(await resolveWindowsAppPath("Chrome", run, { SystemRoot: windows })).toBe(exe);
  expect(queries).toEqual([
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Chrome.exe",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Chrome.exe",
  ]);
});

it("leaves paths, system folder names and unregistered apps to the helper", async () => {
  let calls = 0;
  const run: DesktopRunner = async () => {
    calls++;
    return { stdout: "", exitCode: 1 };
  };
  for (const name of ["C:\\x\\app.exe", "a/b", 'x"y'])
    expect(await resolveWindowsAppPath(name, run)).toBeUndefined();
  expect(calls).toBe(0);
  const windows = tempDir();
  expect(await resolveWindowsAppPath("missing", run, { SystemRoot: windows })).toBeUndefined();
  expect(calls).toBe(2);
  // Windows resolves case-insensitively; match the case so a case-sensitive runner agrees.
  writeFileSync(join(windows, "Notepad.exe"), "");
  expect(await resolveWindowsAppPath("Notepad", run, { SystemRoot: windows })).toBeUndefined();
  expect(calls).toBe(2);
});
