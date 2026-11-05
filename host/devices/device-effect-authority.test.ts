import { afterEach, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_DEVICE_VERSION, DEVICE_HUB_VERSION, DeviceHost } from "./device-host";
import * as processes from "./device-process";
import * as expo from "./expo-go";

afterEach(() => vi.restoreAllMocks());
const turn = () => new Promise<void>((ready) => setImmediate(ready));
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((ready) => {
    release = ready;
  });
  return { promise, release };
}
const device = (id: string, platform: "android" | "ios" = "android") => ({
  id,
  name: id,
  platform,
  version: "fixture",
  booted: true,
  physical: false,
});
function fixture(platform: "win32" | "darwin" = "win32", directory = "/unused") {
  const host = new DeviceHost(directory, { platform, env: {} });
  const internal = host as unknown as {
    device(id: string): Promise<ReturnType<typeof device>>;
    installed(): Promise<boolean>;
    androidBinary(): string;
    runForDevice(id: string, work: () => Promise<void>): Promise<void>;
    runExclusive(work: () => Promise<void>): Promise<void>;
    agentTargets: Map<string, string>;
  };
  const discovery = vi
    .spyOn(internal, "device")
    .mockImplementation(async (id) => device(id, platform === "darwin" ? "ios" : "android"));
  vi.spyOn(internal, "installed").mockResolvedValue(true);
  vi.spyOn(internal, "androidBinary").mockReturnValue("fixture-adb");
  return { host, internal, discovery };
}

function setupFixture(directory: string) {
  const host = new DeviceHost(directory, {
    platform: "win32",
    env: {},
    npmCliPath: join(directory, "fixture-npm-cli.js"),
  });
  vi.spyOn(host, "status").mockResolvedValue({
    running: false,
    installed: false,
    agentInstalled: false,
    platform: "win32",
    platforms: [{ platform: "android", available: true }],
  });
  return host;
}
function fakeInstaller(directory: string, installed?: (name: string) => void | Promise<void>) {
  return vi.spyOn(processes, "deviceCommand").mockImplementation(async (_exe, args, options) => {
    expect(args).toEqual([
      join(directory, "fixture-npm-cli.js"),
      "install",
      "--no-audit",
      "--no-fund",
      "--omit=dev",
    ]);
    const stage = options?.cwd;
    if (!stage) throw new Error("The fake installer requires its exact staging directory");
    expect(resolve(stage).startsWith(resolve(directory) + sep)).toBe(true);
    const spec = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
    const name = Object.keys(spec.dependencies)[0];
    expect(Object.keys(spec.dependencies)).toHaveLength(1);
    expect(spec.dependencies[name]).toBe(
      name === "expo-device-hub" ? DEVICE_HUB_VERSION : AGENT_DEVICE_VERSION,
    );
    expect(["expo-device-hub", "agent-device"]).toContain(name);
    const entry = join(
      stage,
      "node_modules",
      name,
      name === "expo-device-hub" ? "dist/server/cli.mjs" : "bin/agent-device.mjs",
    );
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "fixture; never executed");
    await installed?.(name);
    return "fixture installation completed";
  });
}
async function removeFixture(directory: string) {
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  await rm(directory, { recursive: true, force: true });
}

it("blocks queued setup before entering SDK or filesystem work after revocation", async () => {
  const { host, internal } = fixture();
  const held = gate();
  const prior = internal.runExclusive(() => held.promise);
  await turn();
  const status = vi.spyOn(host, "status").mockRejectedValue(new Error("unexpected SDK probe"));
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue("");
  let authorized = true;
  const setup = host.setup(true, { authorized: () => authorized });
  const rejected = expect(setup).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  authorized = false;
  held.release();
  await Promise.all([prior, rejected]);
  expect(status).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
  await host.dispose();
});

it("leaves admitted install work staged without publishing a completion marker after revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-lifecycle-"));
  const host = setupFixture(directory);
  let authorized = true;
  const command = fakeInstaller(directory, () => {
    authorized = false;
  });
  try {
    await expect(host.setup(true, { authorized: () => authorized })).rejects.toThrow(
      "DEVICE_AUTHORITY_REVOKED",
    );
    expect(command).toHaveBeenCalledOnce();
    const parent = join(directory, "tools", "expo-device-hub");
    const names = await readdir(parent);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(new RegExp(`^${DEVICE_HUB_VERSION.replaceAll(".", "\\.")}\\.stage-`));
    expect(existsSync(join(parent, names[0], ".install-complete"))).toBe(false);
    expect(existsSync(join(parent, DEVICE_HUB_VERSION))).toBe(false);
    expect(existsSync(join(directory, "tools", "agent-device"))).toBe(false);
  } finally {
    await host.dispose();
    await removeFixture(directory);
  }
});

it("restores the exact preserved cache if authority is revoked between promotion renames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-lifecycle-"));
  const host = setupFixture(directory);
  const parent = join(directory, "tools", "expo-device-hub"),
    live = join(parent, DEVICE_HUB_VERSION);
  await mkdir(live, { recursive: true });
  await writeFile(join(live, "preserved.txt"), "original cache");
  const command = fakeInstaller(directory);
  try {
    const effect = {
      authorized: async () => {
        if (
          existsSync(parent) &&
          !existsSync(live) &&
          (await readdir(parent)).some((n) => n.includes(".previous-"))
        )
          return false;
        return true;
      },
    };
    await expect(host.setup(false, effect)).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(command).toHaveBeenCalledOnce();
    expect(await readFile(join(live, "preserved.txt"), "utf8")).toBe("original cache");
    expect(existsSync(join(live, ".install-complete"))).toBe(false);
    const names = await readdir(parent);
    expect(names.some((n) => n.includes(".previous-"))).toBe(false);
    const stage = names.find((n) => n.includes(".stage-"))!;
    expect(await readFile(join(parent, stage, ".install-complete"), "utf8")).toBe(
      DEVICE_HUB_VERSION,
    );
  } finally {
    await host.dispose();
    await removeFixture(directory);
  }
});

it("never overwrites a concurrent live cache while preserving its own previous and stage paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-lifecycle-"));
  const host = setupFixture(directory);
  const parent = join(directory, "tools", "expo-device-hub"),
    live = join(parent, DEVICE_HUB_VERSION);
  await mkdir(live, { recursive: true });
  await writeFile(join(live, "preserved.txt"), "original cache");
  fakeInstaller(directory);
  let replaced = false;
  try {
    const effect = {
      authorized: async () => {
        if (
          !replaced &&
          existsSync(parent) &&
          !existsSync(live) &&
          (await readdir(parent)).some((n) => n.includes(".previous-"))
        ) {
          replaced = true;
          await mkdir(live);
          await writeFile(join(live, "concurrent.txt"), "other owner");
          return false;
        }
        return !replaced;
      },
    };
    await expect(host.setup(false, effect)).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(await readFile(join(live, "concurrent.txt"), "utf8")).toBe("other owner");
    expect(existsSync(join(live, "preserved.txt"))).toBe(false);
    const previous = (await readdir(parent)).find((n) => n.includes(".previous-"))!;
    expect(await readFile(join(parent, previous, "preserved.txt"), "utf8")).toBe("original cache");
  } finally {
    await host.dispose();
    await removeFixture(directory);
  }
});

it("retains a completed pinned installation and stops before the next requested tool", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-lifecycle-"));
  const host = setupFixture(directory);
  const live = join(directory, "tools", "expo-device-hub", DEVICE_HUB_VERSION);
  const command = fakeInstaller(directory);
  try {
    await expect(
      host.setup(true, { authorized: () => !existsSync(join(live, ".install-complete")) }),
    ).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(command).toHaveBeenCalledOnce();
    expect(await readFile(join(live, ".install-complete"), "utf8")).toBe(DEVICE_HUB_VERSION);
    expect(existsSync(join(live, "node_modules", "expo-device-hub", "dist/server/cli.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(directory, "tools", "agent-device"))).toBe(false);
  } finally {
    await host.dispose();
    await removeFixture(directory);
  }
});

it("promotes pinned tools with the real cache owner and preserves explicit setup flags and prior data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-lifecycle-"));
  const sdk = join(directory, "fixture-sdk");
  await mkdir(join(sdk, "platform-tools"), { recursive: true });
  await writeFile(join(sdk, "platform-tools", "adb.exe"), "fixture; never executed");
  const host = new DeviceHost(directory, {
    platform: "win32",
    env: { ANDROID_HOME: sdk },
    npmCliPath: join(directory, "fixture-npm-cli.js"),
  });
  const hubParent = join(directory, "tools", "expo-device-hub"),
    hub = join(hubParent, DEVICE_HUB_VERSION);
  await mkdir(hub, { recursive: true });
  await writeFile(join(hub, "preserved.txt"), "original cache");
  const command = fakeInstaller(directory);
  try {
    expect(await host.setup(false, { authorized: () => true })).toMatchObject({
      installed: true,
      agentInstalled: false,
    });
    expect(command).toHaveBeenCalledOnce();
    expect(existsSync(join(directory, "tools", "agent-device"))).toBe(false);
    const previous = (await readdir(hubParent)).find((name) => name.includes(".previous-"))!;
    expect(await readFile(join(hubParent, previous, "preserved.txt"), "utf8")).toBe(
      "original cache",
    );
    expect(await host.setup(true, { authorized: () => true })).toMatchObject({
      installed: true,
      agentInstalled: true,
    });
    expect(command).toHaveBeenCalledTimes(2);
    expect(await readFile(join(hub, ".install-complete"), "utf8")).toBe(DEVICE_HUB_VERSION);
    expect(
      await readFile(
        join(directory, "tools", "agent-device", AGENT_DEVICE_VERSION, ".install-complete"),
        "utf8",
      ),
    ).toBe(AGENT_DEVICE_VERSION);
  } finally {
    await host.dispose();
    await removeFixture(directory);
  }
});

it("blocks a queued stop without losing its owned sessions", async () => {
  const { host, internal } = fixture();
  const owned = host as unknown as { agentSessions: Set<string> };
  owned.agentSessions.add("owned-one");
  const held = gate(),
    prior = internal.runForDevice("A", () => held.promise);
  await turn();
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue('{"success":true}');
  let authorized = true;
  const stopping = host.stop({ authorized: () => authorized }),
    rejected = expect(stopping).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  authorized = false;
  held.release();
  await Promise.all([prior, rejected]);
  expect(command).not.toHaveBeenCalled();
  expect(owned.agentSessions.has("owned-one")).toBe(true);
  await host.dispose();
  expect(command).toHaveBeenCalledOnce();
  expect(command.mock.calls[0][1]).toContain("owned-one");
});

it("does not turn a revoked public stop into subsequent session cleanup but dispose still owns cleanup", async () => {
  const { host } = fixture();
  const owned = host as unknown as { agentSessions: Set<string> };
  owned.agentSessions.add("owned-one");
  owned.agentSessions.add("owned-two");
  let authorized = true;
  const command = vi.spyOn(processes, "deviceCommand").mockImplementation(async () => {
    authorized = false;
    return '{"success":true}';
  });
  await expect(host.stop({ authorized: () => authorized })).rejects.toThrow(
    "DEVICE_AUTHORITY_REVOKED",
  );
  expect(command).toHaveBeenCalledOnce();
  expect(command.mock.calls[0][1]).toContain("owned-one");
  await host.dispose();
  expect(command.mock.calls.some(([, args]) => args.includes("owned-two"))).toBe(true);
  expect(owned.agentSessions.size).toBe(0);
});

it("retains unconfirmed sessions and their targets when a revoked stop must leave cleanup to disposal", async () => {
  const { host, internal } = fixture();
  const owned = host as unknown as { agentSessions: Set<string> };
  for (const id of ["owned-one", "owned-two"]) {
    owned.agentSessions.add(id);
    internal.agentTargets.set(id, `target-${id}`);
  }
  let authorized = true;
  const command = vi.spyOn(processes, "deviceCommand").mockImplementation(async () => {
    authorized = false;
    return JSON.stringify({ success: false, error: "fixture-close-unconfirmed" });
  });
  await expect(host.stop({ authorized: () => authorized })).rejects.toThrow(
    "DEVICE_AUTHORITY_REVOKED",
  );
  expect(command).toHaveBeenCalledOnce();
  expect([...owned.agentSessions]).toEqual(["owned-one", "owned-two"]);
  expect([...internal.agentTargets.keys()]).toEqual(["owned-one", "owned-two"]);
  command.mockResolvedValue('{"success":true}');
  await host.dispose();
  expect(owned.agentSessions.size).toBe(0);
  expect(internal.agentTargets.size).toBe(0);
  expect(command.mock.calls.slice(1).map(([, args]) => args[3])).toEqual([
    "owned-one",
    "owned-two",
  ]);
});

it("keeps unconfirmed owned sessions when the daemon reports failure despite a zero exit status", async () => {
  const { host, internal } = fixture("darwin");
  vi.spyOn(host, "status").mockResolvedValue({
    running: false,
    installed: true,
    agentInstalled: true,
    platform: "darwin",
    platforms: [],
  });
  const owned = host as unknown as { agentSessions: Set<string> };
  owned.agentSessions.add("owned-one");
  internal.agentTargets.set("owned-one", "target-one");
  const command = vi
    .spyOn(processes, "deviceCommand")
    .mockResolvedValue(JSON.stringify({ success: false, error: "fixture-stop-unconfirmed" }));
  await host.stop({ authorized: () => true });
  expect([...owned.agentSessions]).toEqual(["owned-one"]);
  expect(internal.agentTargets.get("owned-one")).toBe("target-one");
  expect(command.mock.calls.map(([, args]) => args[1])).toEqual(["close", "daemon"]);
  command.mockResolvedValue('{"success":true}');
  await host.dispose();
  expect(owned.agentSessions.size).toBe(0);
  expect(internal.agentTargets.size).toBe(0);
});

it("rechecks after the installed-agent probe before a new daemon stop command", async () => {
  const { host, internal } = fixture("darwin");
  let authorized = true;
  vi.spyOn(internal, "installed").mockImplementation(async () => {
    authorized = false;
    return true;
  });
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue('{"success":true}');
  await expect(host.stop({ authorized: () => authorized })).rejects.toThrow(
    "DEVICE_AUTHORITY_REVOKED",
  );
  expect(command).not.toHaveBeenCalled();
  await host.dispose();
  expect(command).toHaveBeenCalledOnce();
  expect(command.mock.calls[0][1].slice(1, 3)).toEqual(["daemon", "stop"]);
});

it("lets an already admitted owned child termination settle without repeating it on disposal", async () => {
  const { host } = fixture();
  const child = {
    exitCode: null,
    signalCode: null,
  } as unknown as import("node:child_process").ChildProcess;
  const owned = host as unknown as { child?: typeof child; origin?: string };
  owned.child = child;
  owned.origin = "http://127.0.0.1:1234";
  const held = gate(),
    stop = vi.spyOn(processes, "stopDeviceChild").mockImplementation(() => held.promise);
  let authorized = true;
  const stopping = host.stop({ authorized: () => authorized }),
    rejected = expect(stopping).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  authorized = false;
  held.release();
  await rejected;
  expect(owned.child).toBeUndefined();
  expect(owned.origin).toBeUndefined();
  await host.dispose();
  expect(stop).toHaveBeenCalledOnce();
});

it("rejects revoked queued input without blocking an independent device", async () => {
  const { host, internal, discovery } = fixture();
  const held = gate();
  const prior = internal.runForDevice("A", () => held.promise);
  await turn();
  let authorized = true;
  const effect = { authorized: () => authorized };
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue("");
  const queued = host.action("A", { type: "press", x: 1, y: 2 }, effect);
  const rejected = expect(queued).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  try {
    await host.action("B", { type: "press", x: 3, y: 4 }, { authorized: () => true });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][1][1]).toBe("B");
    authorized = false;
    held.release();
    await Promise.all([prior, rejected]);
    expect(discovery.mock.calls.map(([id]) => id)).toEqual(["B"]);
    expect(command).toHaveBeenCalledTimes(1);
  } finally {
    held.release();
    await Promise.allSettled([prior, queued]);
    await host.dispose();
  }
});

it("rechecks global queue authority before starting a hub", async () => {
  const { host, internal } = fixture();
  const held = gate();
  const prior = internal.runExclusive(() => held.promise);
  await turn();
  const status = vi.spyOn(host, "status").mockRejectedValue(new Error("unexpected status work"));
  let authorized = true;
  const starting = host.start({ authorized: () => authorized });
  const rejected = expect(starting).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  authorized = false;
  held.release();
  await Promise.all([prior, rejected]);
  expect(status).not.toHaveBeenCalled();
  await host.dispose();
});

it("does not install Expo Go if authority expires during the admitted cache/download work", async () => {
  const { host } = fixture();
  let authorized = true;
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue("");
  const cached = vi.spyOn(expo, "cachedExpoGo").mockImplementation(async () => {
    authorized = false;
    return { app: "fixture.apk", versionName: "57.0.0" };
  });
  try {
    await expect(
      host.prepareExpo("A", "57.0.0", true, { authorized: () => authorized }),
    ).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(cached).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][1]).toContain("dumpsys");
    expect(command.mock.calls[0][1]).not.toContain("install");
  } finally {
    await host.dispose();
  }
});

it("rechecks after target discovery before issuing Android input", async () => {
  const { host, discovery } = fixture();
  const held = gate();
  discovery.mockImplementation(async (id) => {
    await held.promise;
    return device(id);
  });
  let authorized = true;
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue("");
  const input = host.action("A", { type: "home" }, { authorized: () => authorized });
  const rejected = expect(input).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  await turn();
  authorized = false;
  held.release();
  await rejected;
  expect(command).not.toHaveBeenCalled();
  await host.dispose();
});

it("does not send input after a previously admitted agent open settles under revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-authority-"));
  const { host, internal } = fixture("darwin", directory);
  internal.agentTargets.set("bycoda-ios-sim", "com.example.original");
  let authorized = true;
  const command = vi.spyOn(processes, "deviceCommand").mockImplementation(async (_exe, args) => {
    if (args[1] === "session") return JSON.stringify({ success: true, data: { sessions: [] } });
    if (args[1] === "open") {
      authorized = false;
      return JSON.stringify({ success: true, data: { appBundleId: "com.example.original" } });
    }
    return JSON.stringify({ success: true });
  });
  try {
    await expect(
      host.action("sim", { type: "press", x: 1, y: 2 }, { authorized: () => authorized }),
    ).rejects.toThrow("Already admitted input may have taken effect");
    expect(command.mock.calls.map(([, args]) => args[1])).toEqual(["session", "open"]);
    expect(internal.agentTargets.get("bycoda-ios-sim")).toBe("com.example.original");
  } finally {
    await host.dispose();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
});

it("blocks a tap after an agent element snapshot returns to a revoked request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-device-authority-"));
  const { host, internal } = fixture("darwin", directory);
  internal.agentTargets.set("bycoda-ios-sim", "com.example.original");
  let authorized = true;
  const command = vi.spyOn(processes, "deviceCommand").mockImplementation(async (_exe, args) => {
    if (args[1] === "session")
      return JSON.stringify({
        success: true,
        data: { sessions: [{ name: "bycoda-ios-sim", platform: "ios", id: "sim" }] },
      });
    if (args[1] === "snapshot") {
      authorized = false;
      return JSON.stringify({
        success: true,
        data: {
          nodes: [
            {
              type: "Button",
              label: "Open",
              hittable: true,
              rect: { x: 1, y: 1, width: 2, height: 2 },
            },
          ],
        },
      });
    }
    return JSON.stringify({ success: true });
  });
  try {
    await expect(
      host.action("sim", { type: "pressElement", label: "Open" }, { authorized: () => authorized }),
    ).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
    expect(command.mock.calls.map(([, args]) => args[1])).toEqual(["session", "snapshot"]);
  } finally {
    await host.dispose();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
});

it("suppresses a completed or cached screenshot after authority is revoked", async () => {
  const { host } = fixture();
  let authorized = true;
  const binary = vi.spyOn(processes, "deviceBinaryCommand").mockImplementation(async () => {
    authorized = false;
    return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  });
  try {
    await expect(host.capture("A", { authorized: () => authorized })).rejects.toThrow(
      "DEVICE_AUTHORITY_REVOKED",
    );
    await expect(host.capture("A", { authorized: () => false })).rejects.toThrow(
      "DEVICE_AUTHORITY_REVOKED",
    );
    expect(binary).toHaveBeenCalledTimes(1);
    // A fresh authorized read captures independently; the revoked result was not cached.
    expect((await host.capture("A", { authorized: () => true })).base64).toBe("iVBORw0KGgo=");
    expect(binary).toHaveBeenCalledTimes(2);
    await expect(host.capture("A", { authorized: () => false })).rejects.toThrow(
      "DEVICE_AUTHORITY_REVOKED",
    );
    expect(binary).toHaveBeenCalledTimes(2);
  } finally {
    await host.dispose();
  }
});

it("does not publish a frame into the cache when authority is lost at capture promise settlement", async () => {
  const { host } = fixture();
  const internal = host as unknown as {
    captureFrame(): Promise<{ mime: "image/png"; base64: string; capturedAt: string }>;
    lastCapture?: unknown;
  };
  const held = gate();
  let authorized = true;
  const capture = vi.spyOn(internal, "captureFrame").mockImplementation(async () => {
    await held.promise;
    return { mime: "image/png", base64: "private-frame", capturedAt: "now" };
  });
  const result = host.capture("A", { authorized: () => authorized });
  const rejected = expect(result).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  await turn();
  expect(capture).toHaveBeenCalledOnce();
  authorized = false;
  held.release();
  await rejected;
  expect(internal.lastCapture).toBeUndefined();
  await expect(host.capture("A", { authorized: () => false })).rejects.toThrow(
    "DEVICE_AUTHORITY_REVOKED",
  );
  expect(capture).toHaveBeenCalledOnce();
  await host.dispose();
});

it("waits for asynchronous queued authorization and rejects without entering target work", async () => {
  const { host, discovery } = fixture();
  const held = gate();
  const command = vi.spyOn(processes, "deviceCommand").mockResolvedValue("");
  let authorized = true;
  const input = host.action(
    "A",
    { type: "home" },
    {
      authorized: async () => {
        await held.promise;
        return authorized;
      },
    },
  );
  const rejected = expect(input).rejects.toThrow("DEVICE_AUTHORITY_REVOKED");
  await turn();
  expect(discovery).not.toHaveBeenCalled();
  authorized = false;
  held.release();
  await rejected;
  expect(command).not.toHaveBeenCalled();
  await host.dispose();
});
