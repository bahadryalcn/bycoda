import { describe, expect, it, vi } from "vitest";
import { deviceActionArgs, DeviceHost } from "./device-host";
import * as deviceProcesses from "./device-process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as childProcesses from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
describe("device boundaries", () => {
  it("requires explicit control setup before using the Windows Android SDK without an agent daemon", async () => {
    const host = new DeviceHost("/nonexistent-bycoda-device-cache", {
      env: { ANDROID_HOME: "C:/existing-sdk" },
      platform: "win32",
    });
    const list = vi.spyOn(host, "list").mockResolvedValue({
      devices: [
        {
          id: "emulator-5554",
          name: "Pixel",
          platform: "android",
          version: "Android",
          booted: true,
          physical: false,
        },
      ],
      errors: [],
    });
    const installed = vi
      .spyOn(host as unknown as { installed: () => Promise<boolean> }, "installed")
      .mockResolvedValue(false);
    const command = vi.spyOn(deviceProcesses, "deviceCommand").mockResolvedValue("");
    try {
      await expect(host.action("emulator-5554", { type: "home" })).rejects.toThrow(
        "Enable agent control",
      );
      expect(command).not.toHaveBeenCalled();
      installed.mockResolvedValue(true);
      await expect(host.action("emulator-5554", { type: "home" })).resolves.toContain(
        '"success":true',
      );
      expect(command.mock.calls[0][0]).toMatch(/platform-tools[\\/]adb\.exe$/);
      expect(command.mock.calls[0][1]).toEqual([
        "-s",
        "emulator-5554",
        "shell",
        "input",
        "keyevent",
        "KEYCODE_HOME",
      ]);
      expect(command).toHaveBeenCalledTimes(1);
      await host.dispose();
      expect(command).toHaveBeenCalledTimes(1);
    } finally {
      command.mockRestore();
      installed.mockRestore();
      list.mockRestore();
    }
  });
  it("starts Windows hubs with Android-only discovery and preserves both platforms on Mac", async () => {
    for (const platform of ["win32", "darwin"] as const) {
      const host = new DeviceHost("/nonexistent-bycoda-device-cache", { env: {}, platform });
      const status = vi.spyOn(host, "status").mockResolvedValue({
        running: false,
        installed: true,
        agentInstalled: false,
        platform,
        platforms: [],
      });
      const installed = vi
        .spyOn(host as unknown as { installed: () => Promise<boolean> }, "installed")
        .mockResolvedValue(true);
      const child = new EventEmitter() as childProcesses.ChildProcess;
      Object.assign(child, {
        exitCode: null,
        signalCode: null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => {
          child.emit("close", 0);
          return true;
        }),
      });
      const spawn = vi.spyOn(childProcesses, "spawn").mockReturnValue(child);
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
      const command = vi.spyOn(deviceProcesses, "deviceCommand").mockResolvedValue("{}");
      try {
        await host.start();
        const args = spawn.mock.calls[0][1] as string[];
        if (platform === "win32") expect(args.slice(-2)).toEqual(["--platform", "android"]);
        else expect(args).not.toContain("--platform");
        expect(spawn.mock.calls[0][2]).toMatchObject({ windowsHide: true, shell: false });
        await host.dispose();
      } finally {
        command.mockRestore();
        fetch.mockRestore();
        spawn.mockRestore();
        installed.mockRestore();
        status.mockRestore();
      }
    }
  });
  it("opens a device-bound agent session before input commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-agent-session-test-"));
    const host = new DeviceHost(directory, { env: {}, platform: "linux" });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: true,
      platform: "darwin",
      platforms: [],
    });
    const installed = vi
      .spyOn(host as unknown as { installed: () => Promise<boolean> }, "installed")
      .mockResolvedValue(true);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        simulators: [
          { id: "simulator-id", name: "iPhone", platform: "ios", booted: true, physical: false },
        ],
      }),
    );
    let opened = false;
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockImplementation(async (_exe, args) => {
        if (args[1] === "session") return '{"success":true,"data":{"sessions":[]}}';
        expect(args).toContain("--udid");
        expect(args).toContain("simulator-id");
        if (args[1] === "open") {
          expect(args[2]).toBe("com.apple.springboard");
          opened = true;
        } else if (!opened) throw new Error("SESSION_NOT_FOUND");
        return '{"success":true}';
      });
    try {
      await expect(host.action("simulator-id", { type: "home" })).resolves.toContain(
        '"success":true',
      );
      // An idle daemon can lose its session while the host still remembers it.
      await expect(host.action("simulator-id", { type: "home" })).resolves.toContain(
        '"success":true',
      );
      expect(command.mock.calls.map((call) => call[1][1])).toEqual([
        "session",
        "open",
        "home",
        "session",
        "open",
        "home",
      ]);
      command.mockImplementation(async (_exe, args) =>
        args[1] === "session"
          ? '{"success":true,"data":{"sessions":[]}}'
          : args[1] === "open"
            ? '{"success":true}'
            : '{"success":false,"error":{"message":"XCTest failed"}}',
      );
      await expect(host.action("simulator-id", { type: "home" })).rejects.toThrow("XCTest failed");
    } finally {
      command.mockRestore();
      fetch.mockRestore();
      installed.mockRestore();
      status.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("captures a simulator through the pinned hub POST-only screenshot endpoint", async () => {
    const host = new DeviceHost("/nonexistent-bycoda-device-cache", { env: {}, platform: "linux" });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: false,
      platform: "darwin",
      platforms: [],
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/api/devices"))
        return Response.json({
          simulators: [
            {
              id: "simulator-id",
              name: "iPhone",
              platform: "ios",
              version: "27",
              booted: true,
              physical: false,
            },
          ],
        });
      // expo-device-hub 0.12.0 serve-sim returns 405 for GET screenshots.
      if (init?.method !== "POST") return new Response("method not allowed", { status: 405 });
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png" },
      });
    });
    try {
      const frame = await host.capture("simulator-id");
      expect(frame.mime).toBe("image/png");
      expect(Buffer.from(frame.base64, "base64")).toEqual(Buffer.from([137, 80, 78, 71]));
    } finally {
      fetch.mockRestore();
      status.mockRestore();
    }
  });
  it("lists unused iOS simulators omitted by the hub", async () => {
    const host = new DeviceHost("/nonexistent-bycoda-device-cache", {
      env: {},
      platform: "darwin",
    });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: false,
      platform: "darwin",
      platforms: [],
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ simulators: [], errors: [] }));
    const command = vi.spyOn(deviceProcesses, "deviceCommand").mockResolvedValue(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
            { udid: "unused", name: "New iPhone", state: "Shutdown", isAvailable: true },
          ],
          "com.apple.CoreSimulator.SimRuntime.tvOS-27-0": [
            { udid: "tv", name: "Apple TV", state: "Shutdown", isAvailable: true },
          ],
        },
      }),
    );
    try {
      await expect(host.list()).resolves.toEqual({
        devices: [
          {
            id: "unused",
            name: "New iPhone",
            platform: "ios",
            version: "iOS 27.0",
            booted: false,
            physical: false,
          },
        ],
        errors: [],
      });
      expect(command).toHaveBeenCalledWith(
        "/usr/bin/xcrun",
        ["simctl", "list", "devices", "available", "--json"],
        expect.objectContaining({ timeoutMs: 10_000 }),
      );
    } finally {
      command.mockRestore();
      fetch.mockRestore();
      status.mockRestore();
    }
  });
  it("discovers Windows AVDs through native executables without avdmanager.bat", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-windows-sdk-test-"));
    await mkdir(join(directory, "emulator"));
    await writeFile(join(directory, "emulator", "emulator.exe"), "");
    const host = new DeviceHost(directory, {
      env: { ANDROID_HOME: directory, PATH: "original" },
      platform: "win32",
    });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: false,
      platform: "win32",
      platforms: [],
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        emulators: [],
        errors: [{ message: "[android-utils] Failed to run avdmanager" }],
      }),
    );
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockImplementation(async (exe, args, options) => {
        expect(options?.env?.PATH).toContain(join(directory, "platform-tools"));
        expect(exe).not.toContain("avdmanager");
        if (args[0] === "devices")
          return "List of devices attached\nemulator-5554\tdevice\nphone-serial\tdevice product:galaxy model:SM_S928B device:e3q\n";
        if (args[0] === "-list-avds") return "New_AVD\nRunning_AVD\n";
        return "Running_AVD\nOK\n";
      });
    try {
      const result = await host.list();
      expect(result.errors).toEqual([]);
      expect(result.devices).toEqual([
        {
          id: "New_AVD",
          name: "New_AVD",
          platform: "android",
          version: "Android",
          booted: false,
          physical: false,
        },
        {
          id: "emulator-5554",
          name: "Running_AVD",
          platform: "android",
          version: "Android",
          booted: true,
          physical: false,
        },
        {
          id: "phone-serial",
          name: "SM S928B",
          platform: "android",
          version: "Android",
          booted: true,
          physical: true,
        },
      ]);
    } finally {
      command.mockRestore();
      fetch.mockRestore();
      status.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("discovers connected Windows phones despite a hub 503 and captures directly through adb", async () => {
    const host = new DeviceHost("/nonexistent-bycoda-device-cache", {
      env: { ANDROID_HOME: "C:/existing-sdk" },
      platform: "win32",
    });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: false,
      platform: "win32",
      platforms: [],
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockResolvedValue("List of devices attached\nphone-serial\tdevice model:Galaxy_S24\n");
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128]);
    const binary = vi.spyOn(deviceProcesses, "deviceBinaryCommand").mockResolvedValue(image);
    try {
      const listed = await host.list();
      expect(listed.errors).toEqual([]);
      expect(listed.devices).toEqual([
        expect.objectContaining({
          id: "phone-serial",
          name: "Galaxy S24",
          booted: true,
          physical: true,
        }),
      ]);
      expect(command).toHaveBeenCalledWith(
        expect.stringMatching(/adb\.exe$/),
        ["devices", "-l"],
        expect.anything(),
      );
      const frame = await host.capture("phone-serial");
      expect(frame.mime).toBe("image/png");
      expect(Buffer.from(frame.base64, "base64")).toEqual(image);
      expect(binary).toHaveBeenCalledWith(
        expect.stringMatching(/adb\.exe$/),
        ["-s", "phone-serial", "exec-out", "screencap", "-p"],
        expect.objectContaining({ timeoutMs: 20_000 }),
      );
      expect(fetch.mock.calls.every(([url]) => String(url).endsWith("/api/devices"))).toBe(true);
      binary.mockResolvedValue(Buffer.from("SDK diagnostic text"));
      Object.assign(host, { lastCapture: undefined });
      await expect(host.capture("phone-serial")).rejects.toThrow("unsupported format");
    } finally {
      binary.mockRestore();
      command.mockRestore();
      fetch.mockRestore();
      status.mockRestore();
    }
  });
  it("refreshes the frame immediately after a device action", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-device-frame-test-"));
    const host = new DeviceHost(directory, { env: {}, platform: "linux" });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: true,
      platform: "linux",
      platforms: [],
    });
    const installed = vi
      .spyOn(host as unknown as { installed: () => Promise<boolean> }, "installed")
      .mockResolvedValue(true);
    let captures = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).endsWith("/api/devices")
        ? Response.json({
            simulators: [
              { id: "sim", name: "iPhone", platform: "ios", booted: true, physical: false },
            ],
          })
        : new Response(new Uint8Array([++captures]), {
            headers: { "Content-Type": "image/png" },
          }),
    );
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockImplementation(async (_exe, args) =>
        args[1] === "session" ? '{"success":true,"data":{"sessions":[]}}' : '{"success":true}',
      );
    try {
      const before = await host.capture("sim");
      await host.action("sim", { type: "home" });
      const after = await host.capture("sim");
      expect(after.base64).not.toBe(before.base64);
      expect(captures).toBe(2);
    } finally {
      command.mockRestore();
      fetch.mockRestore();
      installed.mockRestore();
      status.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("does not claim iOS support from xcrun alone", async () => {
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockRejectedValue(new Error("unable to find utility simctl"));
    try {
      const host = new DeviceHost("/nonexistent-bycoda-device-cache", {
        env: {},
        platform: "darwin",
      });
      expect(
        (await host.status()).platforms.find((platform) => platform.platform === "ios")?.available,
      ).toBe(false);
    } finally {
      command.mockRestore();
    }
  });
  it("creates only known action argument arrays", () => {
    expect(deviceActionArgs({ type: "openApp", app: "  Settings  " })).toEqual([
      "open",
      "Settings",
    ]);
    expect(deviceActionArgs({ type: "openApp", app: "com.apple.springboard" })).toEqual([
      "open",
      "com.apple.springboard",
    ]);
    for (const app of ["", "-config", "Settings\n", "a\0b", "a".repeat(257)])
      expect(() => deviceActionArgs({ type: "openApp", app })).toThrow("Invalid device app target");
    expect(deviceActionArgs({ type: "press", x: 10, y: 20 })).toEqual(["press", "10", "20"]);
    expect(deviceActionArgs({ type: "type", text: "hello; whoami" })).toEqual([
      "type",
      "hello; whoami",
    ]);
    expect(() => deviceActionArgs({ type: "press", x: -1, y: 20 })).toThrow();
    expect(() => deviceActionArgs({ type: "type", text: "--config=/private" })).toThrow();
    expect(() => deviceActionArgs({ type: "shell", text: "exec" } as never)).toThrow("Unsupported");
  });
  it("does not start or install on status and reports unsupported SDKs", async () => {
    const host = new DeviceHost("/nonexistent-bycoda-device-cache", { platform: "linux", env: {} });
    const status = await host.status();
    expect(status.running).toBe(false);
    expect(status.installed).toBe(false);
    expect(status.platforms.every((platform) => !platform.available)).toBe(true);
    await expect(host.setup(false)).rejects.toThrow("SDK");
    await expect(host.capture("arbitrary")).rejects.toThrow("stopped");
    await host.dispose();
    await expect(host.start()).rejects.toThrow("disposed");
  });
  it("opens an explicit app once and remembers its resolved bundle for daemon reconnect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-device-target-test-"));
    const host = new DeviceHost(directory, { env: {}, platform: "linux" });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: true,
      platform: "linux",
      platforms: [],
    });
    const installed = vi
      .spyOn(host as unknown as { installed: () => Promise<boolean> }, "installed")
      .mockResolvedValue(true);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        simulators: [{ id: "sim", name: "iPhone", platform: "ios", booted: true, physical: false }],
      }),
    );
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockImplementation(async (_exe, args) => {
        if (args[1] === "session") return '{"success":true,"data":{"sessions":[]}}';
        if (args[1] === "open")
          return '{"success":true,"data":{"appBundleId":"com.apple.Preferences"}}';
        return '{"success":true}';
      });
    try {
      await expect(host.action("sim", { type: "press", x: 1, y: 2 })).rejects.toThrow(
        "Open an app before controlling this iOS simulator.",
      );
      expect(command.mock.calls.map((call) => call[1][1])).toEqual(["session"]);
      command.mockClear();
      await host.action("sim", { type: "openApp", app: "Settings" });
      expect(command.mock.calls.map((call) => call[1][1])).toEqual(["session", "open"]);
      expect(command.mock.calls[1][1][2]).toBe("Settings");
      command.mockClear();
      await host.action("sim", { type: "type", text: "hello" });
      expect(command.mock.calls.map((call) => call[1][1])).toEqual(["session", "open", "type"]);
      expect(command.mock.calls[1][1][2]).toBe("com.apple.Preferences");
      expect(command.mock.calls[2][1][2]).toBe("hello");
    } finally {
      command.mockRestore();
      fetch.mockRestore();
      installed.mockRestore();
      status.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("does not infer an iOS app target from an existing device session or failed open", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-device-target-failure-"));
    const host = new DeviceHost(directory, { env: {}, platform: "linux" });
    Object.assign(host, { origin: "http://127.0.0.1:12345" });
    const status = vi.spyOn(host, "status").mockResolvedValue({
      running: true,
      installed: true,
      agentInstalled: true,
      platform: "linux",
      platforms: [],
    });
    const installed = vi
      .spyOn(host as unknown as { installed: () => Promise<boolean> }, "installed")
      .mockResolvedValue(true);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        simulators: [{ id: "sim", name: "iPhone", platform: "ios", booted: true, physical: false }],
      }),
    );
    const command = vi
      .spyOn(deviceProcesses, "deviceCommand")
      .mockImplementation(async (_exe, args) =>
        args[1] === "session"
          ? '{"success":true,"data":{"sessions":[{"name":"bycoda-ios-sim","platform":"ios","id":"sim"}]}}'
          : '{"success":false,"error":"app unavailable"}',
      );
    try {
      await expect(host.action("sim", { type: "snapshot" })).rejects.toThrow(
        "Open an app before controlling",
      );
      await expect(host.action("sim", { type: "openApp", app: "Missing" })).rejects.toThrow(
        "app unavailable",
      );
      await expect(host.action("sim", { type: "type", text: "hello" })).rejects.toThrow(
        "Open an app before controlling",
      );
      expect(command.mock.calls.map((call) => call[1][1])).toEqual([
        "session",
        "session",
        "open",
        "session",
      ]);
    } finally {
      command.mockRestore();
      fetch.mockRestore();
      installed.mockRestore();
      status.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
