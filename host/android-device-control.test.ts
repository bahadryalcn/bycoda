import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  androidDeviceControl,
  androidPackageTarget,
  androidTextArgument,
  quoteAndroidShell,
} from "./android-device-control";
import { deviceCommand } from "./device-process";

describe("Windows Android SDK controls", () => {
  it("passes native coordinates and Home through bounded argument arrays", async () => {
    const command = vi.fn<typeof deviceCommand>().mockResolvedValue("");
    await androidDeviceControl("adb.exe", "emulator-5554", { type: "home" }, { command });
    await androidDeviceControl(
      "adb.exe",
      "emulator-5554",
      { type: "press", x: 4, y: 5 },
      { command },
    );
    await androidDeviceControl(
      "adb.exe",
      "emulator-5554",
      { type: "swipe", x: 1, y: 2, endX: 3, endY: 4 },
      { command },
    );
    expect(command.mock.calls.map((call) => call[1])).toEqual([
      ["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_HOME"],
      ["-s", "emulator-5554", "shell", "input", "tap", "4", "5"],
      ["-s", "emulator-5554", "shell", "input", "swipe", "1", "2", "3", "4"],
    ]);
    expect(command.mock.calls.every((call) => call[2]?.timeoutMs === 30_000)).toBe(true);
    await expect(
      androidDeviceControl("adb.exe", "--help", { type: "home" }, { command }),
    ).rejects.toThrow("serial");
    await expect(
      androidDeviceControl("adb.exe", "emulator-5554", { type: "press", x: -1, y: 2 }, { command }),
    ).rejects.toThrow("coordinate");
  });
  it("quotes shell metacharacters literally and rejects unsupported text before dispatch", async () => {
    const command = vi.fn<typeof deviceCommand>().mockResolvedValue("");
    const text = "a ' ; echo injected # $(echo nested) `echo more` & | %";
    await androidDeviceControl("adb.exe", "emulator-5554", { type: "type", text }, { command });
    expect(command.mock.calls[0][1]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "input",
      "text",
      quoteAndroidShell(text.replaceAll(" ", "%s")),
    ]);
    const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
    if (existsSync(shell)) {
      // A real POSIX shell must preserve this as one literal word. The harmless
      // substitutions would visibly alter output if escaping were incorrect.
      expect(await deviceCommand(shell, ["-c", `printf '%s' ${quoteAndroidShell(text)}`])).toBe(
        text,
      );
    }
    command.mockClear();
    for (const invalid of ["a\nb", "a\0b", "Türkçe", "literal %s", "a".repeat(4097)]) {
      expect(() => androidTextArgument(invalid)).toThrow("printable ASCII");
      await expect(
        androidDeviceControl(
          "adb.exe",
          "emulator-5554",
          { type: "type", text: invalid },
          { command },
        ),
      ).rejects.toThrow("printable ASCII");
    }
    expect(command).not.toHaveBeenCalled();
  });
  it("resolves only validated package launchers and never executes user flags", async () => {
    const command = vi
      .fn<typeof deviceCommand>()
      .mockResolvedValueOnce("com.android.settings/.Settings\n")
      .mockResolvedValueOnce("Starting: Intent\n");
    await expect(
      androidDeviceControl(
        "adb.exe",
        "emulator-5554",
        { type: "openApp", app: "Settings" },
        { command },
      ),
    ).resolves.toContain("com.android.settings");
    expect(command.mock.calls[0][1]).toContain("com.android.settings");
    expect(command.mock.calls[1][1]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "'com.android.settings/.Settings'",
    ]);
    for (const invalid of [
      "--user 0",
      "com.example;echo bad",
      "https://example.com",
      "com.example/.Other",
      "a".repeat(257),
    ])
      expect(() => androidPackageTarget(invalid)).toThrow("package ID");
    command.mockReset().mockResolvedValue("com.other.app/.Main");
    await expect(
      androidDeviceControl(
        "adb.exe",
        "emulator-5554",
        { type: "openApp", app: "com.example.app" },
        { command },
      ),
    ).rejects.toThrow("launcher activity");
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("preserves Java nested activity names containing a dollar sign as literal shell arguments", async () => {
    const command = vi
      .fn<typeof deviceCommand>()
      .mockResolvedValueOnce("com.example.app/.Main$Nested\n")
      .mockResolvedValueOnce("Starting: Intent\n");
    await androidDeviceControl(
      "adb.exe",
      "emulator-5554",
      { type: "openApp", app: "com.example.app" },
      { command },
    );
    expect(command.mock.calls[1][1]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "'com.example.app/.Main$Nested'",
    ]);
    command.mockReset().mockResolvedValue("com.example.app/.Main;echo injected");
    await expect(
      androidDeviceControl(
        "adb.exe",
        "emulator-5554",
        { type: "openApp", app: "com.example.app" },
        { command },
      ),
    ).rejects.toThrow("launcher activity");
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("reports command-level Android errors even when adb exits zero", async () => {
    const command = vi
      .fn<typeof deviceCommand>()
      .mockResolvedValue("Error: unable to resolve Intent");
    await expect(
      androidDeviceControl("adb.exe", "emulator-5554", { type: "home" }, { command }),
    ).rejects.toThrow("Android device command failed");
  });
  it("reads bounded snapshots and cleans only its unique device file on success or failure", async () => {
    for (const response of [
      '<?xml version="1.0"?><hierarchy><node text="Error: visible app text"/></hierarchy>',
      "not XML",
      '<?xml version="1.0"?><hierarchy>' + "x".repeat(512 * 1024),
    ]) {
      const command = vi
        .fn<typeof deviceCommand>()
        .mockResolvedValueOnce("UI hierarchy dumped")
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce("");
      const result = androidDeviceControl(
        "adb.exe",
        "emulator-5554",
        { type: "snapshot" },
        { command },
      );
      if (response.includes('text="Error:')) await expect(result).resolves.toContain("hierarchy");
      else await expect(result).rejects.toThrow(/invalid XML|exceeds 512 KiB/);
      const path = command.mock.calls[0][1].at(-1);
      expect(path).toMatch(/^\/data\/local\/tmp\/bycoda-ui-[0-9a-f-]{36}\.xml$/);
      expect(command.mock.calls[1][1]).toEqual(["-s", "emulator-5554", "shell", "cat", path]);
      expect(command.mock.calls[2][1]).toEqual(["-s", "emulator-5554", "shell", "rm", "-f", path]);
    }
    const command = vi
      .fn<typeof deviceCommand>()
      .mockRejectedValueOnce(new Error("UI dump failed"))
      .mockResolvedValueOnce("");
    await expect(
      androidDeviceControl("adb.exe", "emulator-5554", { type: "snapshot" }, { command }),
    ).rejects.toThrow("UI dump failed");
    expect(command.mock.calls[1][1].slice(3, 5)).toEqual(["rm", "-f"]);
  });
});
