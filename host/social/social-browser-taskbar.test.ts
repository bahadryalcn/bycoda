import { describe, expect, it, vi } from "vitest";
import { WINDOWS_TASKBAR_HIDE_SCRIPT, hideBrowserFromTaskbar } from "./social-browser-taskbar";

describe("hideBrowserFromTaskbar", () => {
  it("passes the browser process through the environment with a deadline", async () => {
    const run = vi.fn(async () => "1\r\n");
    await expect(hideBrowserFromTaskbar(4242, { platform: "win32", run })).resolves.toBe(true);
    const [binary, args, options] = run.mock.calls[0] as unknown as [
      string,
      string[],
      { timeout: number; windowsHide: boolean; env: NodeJS.ProcessEnv },
    ];
    expect(binary).toMatch(/powershell\.exe$/i);
    expect(args.at(-1)).toBe(WINDOWS_TASKBAR_HIDE_SCRIPT);
    expect(WINDOWS_TASKBAR_HIDE_SCRIPT).not.toContain("4242");
    expect(options).toMatchObject({ windowsHide: true, timeout: 20_000 });
    expect(options.env.BYCODA_SOCIAL_BROWSER_PID).toBe("4242");
  });

  it("reports false when no window was found", async () => {
    await expect(
      hideBrowserFromTaskbar(4242, { platform: "win32", run: async () => "0" }),
    ).resolves.toBe(false);
  });

  it.each([undefined, 0, -1, 1.5, "4242"])("never runs for process %s", async (pid) => {
    const run = vi.fn(async () => "1");
    await expect(hideBrowserFromTaskbar(pid, { platform: "win32", run })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("does nothing outside Windows", async () => {
    const run = vi.fn(async () => "1");
    await expect(hideBrowserFromTaskbar(4242, { platform: "linux", run })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
