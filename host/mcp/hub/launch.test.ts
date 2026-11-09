import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHubLaunch, resolveOnPath } from "./launch";

describe("hub launch resolution", () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-launch-"));
  writeFileSync(join(dir, "tool.cmd"), "@echo off\r\n");
  writeFileSync(join(dir, "plain.exe"), "");

  it("finds bare commands on PATH with PATHEXT on Windows and leaves paths alone", async () => {
    const env = { PATH: dir };
    expect(await resolveOnPath("tool", env, "win32")).toBe(join(dir, "tool.cmd"));
    expect(await resolveOnPath("plain", env, "win32")).toBe(join(dir, "plain.exe"));
    expect(await resolveOnPath("missing", env, "win32")).toBeUndefined();
    expect(await resolveOnPath(join(dir, "tool.cmd"), env, "win32")).toBe(join(dir, "tool.cmd"));
    expect(await resolveOnPath("tool", env, "linux")).toBeUndefined();
  });

  it("runs .cmd shims through cmd.exe with quoted arguments and spawns others directly", async () => {
    const env = { PATH: dir, ComSpec: "C:\\Windows\\System32\\cmd.exe" };
    const shim = await resolveHubLaunch("tool", ["a b", 'say "hi"'], env, "win32");
    expect(shim.command).toBe(join(dir, "tool.cmd"));
    expect(shim.shell).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", `""${join(dir, "tool.cmd")}" "a b" "say \\"hi\\"""`],
      windowsVerbatimArguments: true,
    });
    const exe = await resolveHubLaunch("plain", ["x"], env, "win32");
    expect(exe).toEqual({ command: join(dir, "plain.exe"), args: ["x"] });
    const posix = await resolveHubLaunch("npx", ["pkg"], { PATH: dir }, "linux");
    expect(posix).toEqual({ command: "npx", args: ["pkg"] });
  });
});
