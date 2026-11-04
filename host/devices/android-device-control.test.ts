import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  androidDeviceControl,
  androidPackageTarget,
  androidSnapshotNodes,
  androidTextArgument,
  quoteAndroidShell,
} from "./android-device-control";
import { deviceCommand } from "./device-process";

describe("Windows Android SDK controls", () => {
  it("decodes bounded node attributes and numeric XML entities without losing quoted geometry", () => {
    const nodes = androidSnapshotNodes(
      '<hierarchy><node text="A&#231; &#x1F600; &gt;" content-desc="Open" resource-id="pkg:id/button" class="android.widget.Button" clickable="true" enabled="true" bounds="[1,2][30,40]" /></hierarchy>',
    );
    expect(nodes).toEqual([
      {
        label: "Aç 😀 >",
        text: "Aç 😀 >",
        contentDescription: "Open",
        resourceId: "pkg:id/button",
        className: "android.widget.Button",
        clickable: true,
        enabled: true,
        bounds: "[1,2][30,40]",
      },
    ]);
    expect(
      androidSnapshotNodes('<!-- <node text="Fake"/> --><![CDATA[<node text="Fake"/>]]>'),
    ).toEqual([]);
  });
  it("refuses invalid geometry instead of tapping", async () => {
    const command = vi
      .fn<typeof deviceCommand>()
      .mockImplementation(async (_exe, args) =>
        args.includes("cat")
          ? '<?xml version="1.0"?><hierarchy><node text="Open" bounds="[9,10][3,20]"/></hierarchy>'
          : "",
      );
    await expect(
      androidDeviceControl(
        "adb.exe",
        "device",
        { type: "pressElement", label: "Open" },
        { command },
      ),
    ).rejects.toThrow("DEVICE_ELEMENT_BOUNDS_INVALID");
    expect(command.mock.calls.some(([, args]) => args.includes("tap"))).toBe(false);
  });
  it("bounds a hung snapshot by the original wait budget despite wall clock changes", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(-10_000);
    const command = vi
      .fn<typeof deviceCommand>()
      .mockImplementation(async () => new Promise(() => {}));
    try {
      const started = performance.now();
      await expect(
        androidDeviceControl(
          "adb.exe",
          "device",
          { type: "waitForText", text: "Ready", timeoutMs: 60 },
          { command },
        ),
      ).rejects.toThrow("DEVICE_EXPECTATION_TIMEOUT");
      expect(performance.now() - started).toBeLessThan(1000);
      expect(command.mock.calls[0][2]!.timeoutMs).toBeLessThanOrEqual(60);
      expect(command).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });
  it("does not start an adb command when authorization outlives the wait budget", async () => {
    const command = vi.fn<typeof deviceCommand>().mockResolvedValue("");
    let release!: () => void;
    const authorize = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    await expect(
      androidDeviceControl(
        "adb.exe",
        "device",
        { type: "waitForText", text: "Ready", timeoutMs: 40 },
        { command, authorize },
      ),
    ).rejects.toThrow("DEVICE_EXPECTATION_TIMEOUT");
    release();
    await Promise.resolve();
    expect(command).not.toHaveBeenCalled();
  });
  it("cleans only its snapshot file after a timed-out dump actually settles", async () => {
    let finish!: () => void;
    const command = vi.fn<typeof deviceCommand>().mockImplementation(async (_exe, args) => {
      if (args.includes("dump")) await new Promise<void>((resolve) => { finish = resolve; });
      return "";
    });
    const tracked = new Set<Promise<unknown>>();
    const track = <T>(work: Promise<T>) => {
      tracked.add(work);
      void work.then(() => tracked.delete(work), () => tracked.delete(work));
      return work;
    };
    await expect(androidDeviceControl("adb.exe", "device", { type: "waitForText", text: "Ready", timeoutMs: 30 }, { command, track })).rejects.toThrow("DEVICE_EXPECTATION_TIMEOUT");
    expect(command).toHaveBeenCalledTimes(1);
    const path = command.mock.calls[0][1].at(-1);
    expect(tracked.size).toBeGreaterThan(0);
    finish();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls[1][1]).toEqual(["-s", "device", "shell", "rm", "-f", path]);
    expect(command.mock.calls[1][2]?.timeoutMs).toBe(5_000);
    await vi.waitFor(() => expect(tracked.size).toBe(0));
  });
  it("propagates the remaining wait budget to each snapshot command", async () => {
    const command = vi.fn<typeof deviceCommand>().mockImplementation(async (_exe, args) => {
      if (args.includes("dump")) await new Promise((resolve) => setTimeout(resolve, 25));
      return args.includes("cat")
        ? '<?xml version="1.0"?><hierarchy><node text="Ready"/></hierarchy>'
        : "";
    });
    await androidDeviceControl(
      "adb.exe",
      "device",
      { type: "waitForText", text: "Ready", timeoutMs: 1000 },
      { command },
    );
    expect(command).toHaveBeenCalledTimes(3);
    expect(command.mock.calls[1][2]!.timeoutMs!).toBeLessThan(command.mock.calls[0][2]!.timeoutMs!);
    expect(command.mock.calls.every(([, , options]) => options!.timeoutMs! <= 1000)).toBe(true);
  });
  it("blocks launcher input if authority is revoked after package resolution", async () => {
    let authorized = true;
    const authorize = async () => {
      if (!authorized) throw new Error("DEVICE_AUTHORITY_REVOKED");
    };
    const command = vi.fn<typeof deviceCommand>().mockImplementation(async () => {
      authorized = false;
      return "com.android.settings/.Settings\n";
    });
    await expect(
      androidDeviceControl(
        "adb.exe",
        "emulator-5554",
        { type: "openApp", app: "Settings" },
        { command, authorize },
      ),
    ).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][1]).toContain("resolve-activity");
  });
  it("cleans an owned snapshot after revocation without reading it or issuing a tap", async () => {
    let authorized = true;
    const authorize = async () => {
      if (!authorized) throw new Error("DEVICE_AUTHORITY_REVOKED");
    };
    const command = vi.fn<typeof deviceCommand>().mockImplementation(async (_exe, args) => {
      if (args.includes("dump")) authorized = false;
      return "";
    });
    await expect(
      androidDeviceControl(
        "adb.exe",
        "emulator-5554",
        { type: "pressElement", label: "Open" },
        { command, authorize },
      ),
    ).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(command.mock.calls.map(([, args]) => args.slice(3, 5))).toEqual([
      ["uiautomator", "dump"],
      ["rm", "-f"],
    ]);
    expect(command.mock.calls[1][1].at(-1)).toBe(command.mock.calls[0][1].at(-1));
  });
  it("presses a unique decoded label at native screen pixels and refuses duplicates", async () => {
    let duplicate = false;
    const node = '<node text="Aç &amp; git" enabled="true" bounds="[168,2305][1271,2473]" />';
    const command = vi
      .fn<typeof deviceCommand>()
      .mockImplementation(async (_exe, args) =>
        args.includes("cat")
          ? '<?xml version="1.0"?><hierarchy>' + node + (duplicate ? node : "") + "</hierarchy>"
          : "",
      );
    await androidDeviceControl(
      "adb.exe",
      "device",
      { type: "pressElement", label: "Aç & git" },
      { command },
    );
    expect(
      command.mock.calls.some((call) => call[1].slice(-4).join(" ") === "input tap 720 2389"),
    ).toBe(true);
    duplicate = true;
    await expect(
      androidDeviceControl(
        "adb.exe",
        "device",
        { type: "pressElement", label: "Aç & git" },
        { command },
      ),
    ).rejects.toThrow("DEVICE_ELEMENT_AMBIGUOUS");
    expect(command.mock.calls.filter((call) => call[1].includes("tap"))).toHaveLength(1);
  });
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
