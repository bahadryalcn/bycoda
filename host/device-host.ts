import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { deviceBinaryCommand, deviceCommand, stopDeviceChild } from "./device-process";
import { androidDeviceControl } from "./android-device-control";
import type {
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus,
  DeviceSummary,
} from "../src/features/devices/types";

export const DEVICE_HUB_VERSION = "0.12.0";
export const AGENT_DEVICE_VERSION = "0.21.23";
const TOOLS = {
  hub: { name: "expo-device-hub", version: DEVICE_HUB_VERSION, entry: "dist/server/cli.mjs" },
  agent: { name: "agent-device", version: AGENT_DEVICE_VERSION, entry: "bin/agent-device.mjs" },
};
export function deviceActionArgs(action: DeviceAction): string[] {
  const coordinate = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 20000)
      throw new Error("Invalid device coordinate");
    return String(value);
  };
  switch (action.type) {
    case "openApp": {
      if (typeof action.app !== "string") throw new Error("Invalid device app target");
      const app = action.app.trim();
      if (!app || app.length > 256 || /[\0\r\n]/.test(action.app) || app.startsWith("-"))
        throw new Error("Invalid device app target");
      return ["open", app];
    }
    case "press":
      return ["press", coordinate(action.x), coordinate(action.y)];
    case "swipe":
      return [
        "swipe",
        coordinate(action.x),
        coordinate(action.y),
        coordinate(action.endX),
        coordinate(action.endY),
      ];
    case "type":
      if (
        typeof action.text !== "string" ||
        !action.text ||
        action.text.length > 4096 ||
        action.text.includes("\0") ||
        action.text.startsWith("-")
      )
        throw new Error("Invalid device text");
      return ["type", action.text];
    case "home":
      return ["home"];
    case "snapshot":
      return ["snapshot", "-i"];
    default:
      throw new Error("Unsupported device action");
  }
}
function localPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** One owner per host. No hub origin, daemon endpoint or token is returned to clients. */
export class DeviceHost {
  private child?: ChildProcess;
  private origin?: string;
  private error?: string;
  private disposed = false;
  private serial: Promise<unknown> = Promise.resolve();
  private capturePending?: Promise<DeviceFrame>;
  private lastCapture?: { id: string; frame: DeviceFrame; time: number };
  private readonly agentSessions = new Set<string>();
  private readonly agentTargets = new Map<string, string>();
  private readonly stateDir: string;
  private iosSupport?: { checkedAt: number; result: Promise<boolean> };
  constructor(
    private readonly baseDir: string,
    private readonly options: {
      nodePath?: string;
      npmCliPath?: string;
      platform?: NodeJS.Platform;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    this.stateDir = join(baseDir, "devices", "agent-state");
  }
  private get nodePath() {
    return this.options.nodePath ?? process.execPath;
  }
  private get platform() {
    return this.options.platform ?? process.platform;
  }
  private get env() {
    const env = { ...(this.options.env ?? process.env) };
    const sdk =
      this.platform === "darwin"
        ? join(homedir(), "Library/Android/sdk")
        : this.platform === "win32"
          ? join(env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "Android/Sdk")
          : undefined;
    if (
      !env.ANDROID_HOME &&
      !env.ANDROID_SDK_ROOT &&
      sdk &&
      existsSync(join(sdk, "platform-tools"))
    )
      env.ANDROID_HOME = sdk;
    const developer = "/Applications/Xcode.app/Contents/Developer";
    if (
      this.platform === "darwin" &&
      !env.DEVELOPER_DIR &&
      existsSync(join(developer, "usr/bin/simctl"))
    )
      env.DEVELOPER_DIR = developer;
    const javaHome = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
    if (this.platform === "darwin" && !env.JAVA_HOME && existsSync(join(javaHome, "bin/java")))
      env.JAVA_HOME = javaHome;
    const androidRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
    const searchPaths = [
      ...(androidRoot ? [join(androidRoot, "platform-tools"), join(androidRoot, "emulator")] : []),
      ...(env.JAVA_HOME ? [join(env.JAVA_HOME, "bin")] : []),
      ...(env.PATH ?? env.Path ?? "").split(delimiter),
    ].filter(Boolean);
    env.PATH = [...new Set(searchPaths)].join(delimiter);
    return env;
  }
  private dir(tool: keyof typeof TOOLS) {
    const spec = TOOLS[tool];
    return join(this.baseDir, "tools", spec.name, spec.version);
  }
  private entry(tool: keyof typeof TOOLS) {
    return join(this.dir(tool), "node_modules", TOOLS[tool].name, TOOLS[tool].entry);
  }
  private async installed(tool: keyof typeof TOOLS) {
    try {
      return (
        (await readFile(join(this.dir(tool), ".install-complete"), "utf8")) ===
          TOOLS[tool].version && existsSync(this.entry(tool))
      );
    } catch {
      return false;
    }
  }
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.serial
      .catch(() => {})
      .then(() => {
        if (this.disposed) throw new Error("Device host is disposed");
        return operation();
      });
    this.serial = next;
    return next;
  }
  async status(): Promise<DeviceHostStatus> {
    const sdk = this.env.ANDROID_HOME ?? this.env.ANDROID_SDK_ROOT;
    // CommandLineTools also ships xcrun, but cannot run the iOS simulator.
    if (
      this.platform === "darwin" &&
      (!this.iosSupport || Date.now() - this.iosSupport.checkedAt > 10_000)
    ) {
      this.iosSupport = {
        checkedAt: Date.now(),
        result: deviceCommand("/usr/bin/xcrun", ["--find", "simctl"], {
          env: this.env,
          timeoutMs: 5000,
        }).then(
          (path) => !!path.trim(),
          () => false,
        ),
      };
    }
    const ios = this.platform === "darwin" && (await this.iosSupport!.result);
    const android =
      !!sdk &&
      existsSync(join(sdk, "platform-tools", this.platform === "win32" ? "adb.exe" : "adb"));
    return {
      running:
        !!this.origin &&
        !!this.child &&
        this.child.exitCode === null &&
        this.child.signalCode === null,
      installed: await this.installed("hub"),
      agentInstalled: await this.installed("agent"),
      platform: this.platform,
      lastError: this.error,
      platforms: [
        {
          platform: "ios",
          available: ios,
          reason: ios
            ? undefined
            : "iOS Simulator requires a Mac with Xcode and a simulator runtime.",
        },
        {
          platform: "android",
          available: android,
          reason: android
            ? undefined
            : "Set ANDROID_HOME or ANDROID_SDK_ROOT to an Android SDK with platform-tools, emulator and an AVD.",
        },
      ],
    };
  }
  /** Explicit user setup only. npm runs as Node JS (no Windows shell), no global install. */
  setup(agentAccess: boolean): Promise<DeviceHostStatus> {
    return this.runExclusive(async () => {
      if (!(await this.status()).platforms.some((item) => item.available))
        throw new Error("Install a simulator/emulator SDK before device tools.");
      const [major, minor] = process.versions.node.split(".").map(Number);
      if (major < 22 || (major === 22 && minor < 12))
        throw new Error("Device tools require Node.js 22.12 or newer.");
      const npmDirectories = [
        dirname(this.nodePath),
        dirname(dirname(this.nodePath)),
        join(homedir(), ".bycoda-host", "runtime"),
        ...(this.env.PATH ?? "").split(delimiter),
      ].filter(Boolean);
      const npm =
        this.options.npmCliPath ??
        npmDirectories
          .flatMap((directory) => [
            join(directory, "node_modules/npm/bin/npm-cli.js"),
            join(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
          ])
          .find(existsSync);
      if (!npm)
        throw new Error(
          "npm CLI is unavailable beside the host Node runtime. Configure npmCliPath.",
        );
      for (const tool of agentAccess ? (["hub", "agent"] as const) : (["hub"] as const)) {
        const spec = TOOLS[tool];
        const dir = this.dir(tool);
        if (await this.installed(tool)) continue;
        const stage = `${dir}.stage-${randomUUID()}`;
        await mkdir(stage, { recursive: true, mode: 0o700 });
        await writeFile(
          join(stage, "package.json"),
          JSON.stringify({ private: true, dependencies: { [spec.name]: spec.version } }),
          { mode: 0o600 },
        );
        await deviceCommand(
          this.nodePath,
          [npm, "install", "--no-audit", "--no-fund", "--omit=dev"],
          { cwd: stage, env: this.env, timeoutMs: 600_000 },
        );
        if (!existsSync(join(stage, "node_modules", spec.name, spec.entry)))
          throw new Error("Device tool install did not produce the expected executable");
        await writeFile(join(stage, ".install-complete"), spec.version, { mode: 0o600 });
        // Preserve partial/previous directories; never delete tool caches or unrelated work.
        if (existsSync(dir)) await rename(dir, `${dir}.previous-${randomUUID()}`);
        await rename(stage, dir);
      }
      return this.status();
    });
  }
  start(): Promise<DeviceHostStatus> {
    return this.runExclusive(async () => {
      if ((await this.status()).running) return this.status();
      if (!(await this.installed("hub"))) throw new Error("Choose Set up device tools first.");
      const port = await localPort();
      const origin = `http://127.0.0.1:${port}`;
      const child = spawn(
        this.nodePath,
        [
          this.entry("hub"),
          "--port",
          String(port),
          "--host",
          "127.0.0.1",
          "--hide-sidebar",
          "--hide-boot-device",
          ...(this.platform === "win32" ? ["--platform", "android"] : []),
        ],
        {
          env: this.env,
          cwd: this.dir("hub"),
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      this.child = child;
      this.error = undefined;
      child.stdout?.resume();
      child.stderr?.on("data", (value: Buffer) => {
        this.error = value.toString().slice(-2000);
      });
      child.once("error", (cause) => {
        this.error = cause.message;
      });
      child.once("close", () => {
        if (this.child === child) {
          this.origin = undefined;
          this.child = undefined;
        }
      });
      try {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error(this.error ?? "Device hub exited during startup");
          try {
            const response = await fetch(`${origin}/api/devices`, {
              signal: AbortSignal.timeout(1500),
              redirect: "error",
            });
            await response.body?.cancel();
            if (response.ok) {
              this.origin = origin;
              return this.status();
            }
          } catch {
            /* bounded readiness retry */
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("Device hub did not become ready in 30 seconds");
      } catch (cause) {
        await stopDeviceChild(child);
        this.error = String(cause);
        throw cause;
      }
    });
  }
  private async request(path: string, init?: RequestInit): Promise<Response> {
    if (!this.origin || !(await this.status()).running) throw new Error("Device hub is stopped");
    const response = await fetch(`${this.origin}${path}`, {
      ...init,
      signal: AbortSignal.timeout(init?.method === "POST" ? 180_000 : 20_000),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Device hub request failed (${response.status})`);
    }
    return response;
  }
  async list(): Promise<{ devices: DeviceSummary[]; errors: string[] }> {
    type HubDevices = {
      simulators?: DeviceSummary[];
      emulators?: DeviceSummary[];
      errors?: { message: string }[];
    };
    // Native discovery must still run when the optional hub API is unhealthy.
    const nativePlatform = this.platform === "darwin" ? "ios" : "android";
    const canDiscoverNative = this.platform === "darwin" || this.platform === "win32";
    const [hub, native] = await Promise.allSettled([
      this.request("/api/devices").then((response) => response.json() as Promise<HubDevices>),
      canDiscoverNative
        ? this.platform === "darwin"
          ? this.listIos()
          : this.listWindowsAndroid()
        : Promise.resolve(undefined),
    ]);
    if (hub.status === "rejected" && (native.status === "rejected" || !native.value)) {
      throw hub.reason;
    }
    const result = hub.status === "fulfilled" ? hub.value : {};
    let devices = [...(result.simulators ?? []), ...(result.emulators ?? [])]
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          ["ios", "android"].includes(item.platform),
      )
      .slice(0, 200);
    let errors = (result.errors ?? []).map((value) => String(value.message).slice(0, 500));
    // The hub hides simulators without usage history and cannot invoke Windows
    // avdmanager.bat. Native discovery includes fresh devices without a shell.
    if (canDiscoverNative) {
      if (native.status === "fulfilled" && native.value) {
        devices = [
          ...devices.filter((device) => device.platform !== nativePlatform),
          ...native.value,
        ].slice(0, 200);
        errors = errors.filter((error) => !error.toLowerCase().includes(nativePlatform));
        // Windows' native implementation covers all supported devices. A Mac hub
        // failure can still affect Android, so retain it as a partial warning.
        if (hub.status === "rejected" && this.platform === "darwin")
          errors.push(String(hub.reason).slice(0, 500));
      } else if (native.status === "rejected") {
        // Preserve working hub results and expose the actionable SDK failure.
        errors.push(String(native.reason).slice(0, 500));
      }
    }
    return { devices, errors };
  }
  private async listIos(): Promise<DeviceSummary[]> {
    const result = JSON.parse(
      await deviceCommand("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "--json"], {
        env: this.env,
        timeoutMs: 10_000,
      }),
    ) as {
      devices?: Record<
        string,
        { udid: string; name: string; state: string; isAvailable?: boolean }[]
      >;
    };
    return Object.entries(result.devices ?? {})
      .flatMap(([runtime, devices]) =>
        runtime.includes(".iOS-")
          ? devices
              .filter(
                (device) =>
                  device.isAvailable !== false &&
                  typeof device.udid === "string" &&
                  typeof device.name === "string",
              )
              .map((device) => ({
                id: device.udid,
                name: device.name,
                platform: "ios" as const,
                version: `iOS ${runtime.split(".iOS-")[1].replaceAll("-", ".")}`,
                booted: device.state === "Booted",
                physical: false,
              }))
          : [],
      )
      .slice(0, 200);
  }
  private androidBinary(tool: "adb" | "emulator") {
    const sdk = this.env.ANDROID_HOME ?? this.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error("Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK.");
    return join(
      sdk,
      tool === "adb" ? "platform-tools" : "emulator",
      `${tool}${this.platform === "win32" ? ".exe" : ""}`,
    );
  }
  private async listWindowsAndroid(): Promise<DeviceSummary[]> {
    const options = { env: this.env, timeoutMs: 10_000 };
    const adb = this.androidBinary("adb");
    const connected = await deviceCommand(adb, ["devices", "-l"], options);
    const names = existsSync(this.androidBinary("emulator"))
      ? (await deviceCommand(this.androidBinary("emulator"), ["-list-avds"], options))
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean)
          .slice(0, 200)
      : [];
    const devices: DeviceSummary[] = names.map((name) => ({
      id: name,
      name,
      platform: "android",
      version: "Android",
      booted: false,
      physical: false,
    }));
    for (const row of connected.split(/\r?\n/).slice(1).slice(0, 200)) {
      const [serial, state, ...details] = row.trim().split(/\s+/);
      if (!serial || state !== "device") continue;
      const emulator = /^emulator-\d+$/.test(serial);
      const name = emulator
        ? ((await deviceCommand(adb, ["-s", serial, "emu", "avd", "name"], options))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line && line !== "OK") ?? serial)
        : details
            .find((item) => item.startsWith("model:"))
            ?.slice(6)
            .replaceAll("_", " ") || serial;
      const entry = devices.find((device) => device.name === name);
      const online: DeviceSummary = {
        id: serial,
        name,
        platform: "android",
        version: "Android",
        booted: true,
        physical: !emulator,
      };
      if (entry) Object.assign(entry, online);
      else devices.push(online);
    }
    return devices.slice(0, 200);
  }
  private async device(id: string) {
    if (typeof id !== "string" || !id || id.length > 200) throw new Error("Invalid device ID");
    const device = (await this.list()).devices.find((item) => item.id === id);
    if (!device) throw new Error("Device is no longer available; refresh the list");
    return device;
  }
  boot(id: string): Promise<DeviceSummary> {
    return this.runExclusive(async () => {
      const device = await this.device(id);
      if (device.physical) throw new Error("Boot is available only for simulators and emulators");
      if (device.booted) return device;
      this.lastCapture = undefined;
      if (this.platform === "win32" && device.platform === "android") {
        const child = spawn(this.androidBinary("emulator"), ["-avd", device.name, "-no-window"], {
          env: this.env,
          windowsHide: true,
          shell: false,
          stdio: "ignore",
        });
        let failure: Error | undefined;
        child.once("error", (cause) => {
          failure = cause;
        });
        child.unref();
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          if (failure) throw failure;
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error("Android emulator exited before boot completed");
          const started = (await this.listWindowsAndroid()).find(
            (item) => item.name === device.name && item.booted,
          );
          if (
            started &&
            (
              await deviceCommand(
                this.androidBinary("adb"),
                ["-s", started.id, "shell", "getprop", "sys.boot_completed"],
                { env: this.env, timeoutMs: 10_000 },
              )
            ).trim() === "1"
          )
            return started;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(
          "Android emulator did not finish booting in 180 seconds; refresh the device list before retrying.",
        );
      }
      const result = (await (
        await this.request("/api/devices/boot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: device.id, name: device.name, platform: device.platform }),
        })
      ).json()) as { ok: boolean; id?: string; serial?: string; error?: string };
      if (!result.ok) throw new Error(result.error ?? "Device boot failed");
      return { ...device, id: result.serial ?? result.id ?? device.id, booted: true };
    });
  }
  async capture(id: string): Promise<DeviceFrame> {
    if (this.capturePending)
      throw new Error("Another device capture is in progress; wait for it to finish");
    const pending = this.runExclusive(async () => {
      if (this.lastCapture?.id === id && Date.now() - this.lastCapture.time < 1000)
        return this.lastCapture.frame;
      const frame = await this.captureFrame(id);
      this.lastCapture = { id, frame, time: Date.now() };
      return frame;
    });
    this.capturePending = pending;
    try {
      const frame = await pending;
      return frame;
    } finally {
      if (this.capturePending === pending) this.capturePending = undefined;
    }
  }
  private async captureFrame(id: string): Promise<DeviceFrame> {
    const device = await this.device(id);
    if (!device.booted) throw new Error("Boot the device before viewing");
    if (this.platform === "win32" && device.platform === "android") {
      const image = await deviceBinaryCommand(
        this.androidBinary("adb"),
        ["-s", device.id, "exec-out", "screencap", "-p"],
        { env: this.env, timeoutMs: 20_000 },
      );
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error("Device screenshot returned an unsupported format");
      return {
        mime: "image/png",
        base64: image.toString("base64"),
        capturedAt: new Date().toISOString(),
      };
    }
    const response = await this.request(
      `/vendor/${device.platform === "ios" ? "serve-sim" : "serve-emu"}/api/screenshot?device=${encodeURIComponent(device.id)}`,
      { method: "POST" },
    );
    const mime = response.headers.get("content-type")?.split(";")[0];
    if (mime !== "image/png" && mime !== "image/jpeg") {
      await response.body?.cancel();
      throw new Error("Device screenshot returned an unsupported format");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Device screenshot is empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4 * 1024 * 1024) throw new Error("Device screenshot exceeds 4 MiB");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return {
      mime,
      base64: Buffer.concat(chunks).toString("base64"),
      capturedAt: new Date().toISOString(),
    };
  }
  action(id: string, action: DeviceAction): Promise<string> {
    return this.runExclusive(async () => {
      const args = deviceActionArgs(action);
      const device = await this.device(id);
      if (!device.booted) throw new Error("Boot the device before interacting");
      if (!(await this.installed("agent")))
        throw new Error("Enable agent control in device setup first");
      if (this.platform === "win32" && device.platform === "android") {
        this.lastCapture = undefined;
        return androidDeviceControl(this.androidBinary("adb"), device.id, action, {
          env: this.env,
        });
      }
      await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
      const session = `bycoda-${device.platform}-${device.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      const selector = [
        "--platform",
        device.platform,
        device.platform === "ios" ? "--udid" : "--serial",
        device.id,
        "--session",
        session,
        "--json",
      ];
      const options = {
        cwd: this.baseDir,
        env: {
          ...this.env,
          AGENT_DEVICE_STATE_DIR: this.stateDir,
          AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS: "10000",
          AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1",
        },
        timeoutMs: 30_000,
      };
      // The private daemon exits after ten idle seconds. Never trust the local
      // session cache after that exit, and never replay a potentially sent input.
      {
        const active = JSON.parse(
          await deviceCommand(
            this.nodePath,
            [this.entry("agent"), "session", "list", "--json"],
            options,
          ),
        ) as {
          success?: boolean;
          data?: { sessions?: { name: string; platform: string; id: string }[] };
        };
        if (!active.success || !Array.isArray(active.data?.sessions))
          throw new Error("Could not verify device control sessions");
        const existing = active.data.sessions.find((item) => item.name === session);
        if (existing && (existing.platform !== device.platform || existing.id !== device.id))
          throw new Error("Device control session belongs to a different device");
        const remembered = this.agentTargets.get(session);
        if (action.type === "openApp") {
          this.lastCapture = undefined;
          const output = await deviceCommand(
            this.nodePath,
            [this.entry("agent"), ...args, ...selector],
            {
              ...options,
              timeoutMs: 60_000,
            },
          );
          const result = this.verifyAgentResult(output);
          this.agentTargets.set(
            session,
            typeof result.data?.appBundleId === "string" && result.data.appBundleId
              ? result.data.appBundleId
              : args[1],
          );
          this.agentSessions.add(session);
          return output;
        }
        const homeTarget =
          device.platform === "ios" && action.type === "home" ? "com.apple.springboard" : undefined;
        const target = homeTarget ?? remembered;
        // session list does not disclose app targets in the pinned CLI. A
        // previously existing session alone cannot establish safe app ownership.
        if (device.platform === "ios" && !target)
          throw new Error("Open an app before controlling this iOS simulator.");
        if (!existing || (homeTarget && remembered !== homeTarget)) {
          const opened = await deviceCommand(
            this.nodePath,
            [this.entry("agent"), "open", ...(target ? [target] : []), ...selector],
            {
              ...options,
              timeoutMs: 60_000,
            },
          );
          const result = this.verifyAgentResult(opened);
          if (target)
            this.agentTargets.set(
              session,
              typeof result.data?.appBundleId === "string" && result.data.appBundleId
                ? result.data.appBundleId
                : target,
            );
        }
        this.agentSessions.add(session);
      }
      this.lastCapture = undefined;
      const output = await deviceCommand(
        this.nodePath,
        [this.entry("agent"), ...args, ...selector],
        options,
      );
      this.verifyAgentResult(output);
      return output;
    });
  }
  private verifyAgentResult(output: string) {
    const result = JSON.parse(output) as {
      success?: boolean;
      error?: unknown;
      data?: { appBundleId?: string };
    };
    if (result.success !== true) {
      throw new Error(
        `Device action failed: ${JSON.stringify(result.error ?? "agent-device did not confirm success").slice(0, 2000)}`,
      );
    }
    return result;
  }
  private async shutdown() {
    for (const session of this.agentSessions)
      await deviceCommand(
        this.nodePath,
        [this.entry("agent"), "close", "--session", session, "--json"],
        { env: { ...this.env, AGENT_DEVICE_STATE_DIR: this.stateDir }, timeoutMs: 10_000 },
      ).catch((cause: unknown) => {
        this.error = String(cause);
      });
    this.agentSessions.clear();
    this.agentTargets.clear();
    if (this.platform !== "win32" && (await this.installed("agent")))
      await deviceCommand(
        this.nodePath,
        [this.entry("agent"), "daemon", "stop", "--state-dir", this.stateDir],
        { env: this.env, timeoutMs: 10_000 },
      ).catch((cause: unknown) => {
        this.error = String(cause);
      });
    const child = this.child;
    this.origin = undefined;
    this.lastCapture = undefined;
    if (child) await stopDeviceChild(child);
    this.child = undefined;
  }
  stop(): Promise<DeviceHostStatus> {
    return this.runExclusive(async () => {
      await this.shutdown();
      return this.status();
    });
  }
  async dispose() {
    await this.serial.catch(() => {});
    this.disposed = true;
    await this.shutdown();
  }
}
