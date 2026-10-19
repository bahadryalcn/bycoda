import { expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  launchAgent,
  systemdUnit,
  uninstallService,
  stopHostWithServicePolicy,
  stopWindowsHostForUninstall,
} from "./service";

it("recovers an unavailable shutdown endpoint only for a confirmed exited host", async () => {
  const failure = new Error("fetch failed");
  const stop = async () => {
    throw failure;
  };
  await expect(
    stopWindowsHostForUninstall(123, stop, () => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    }),
  ).resolves.toBe(false);
  await expect(stopWindowsHostForUninstall(123, stop, () => true)).rejects.toBe(failure);
  await expect(
    stopWindowsHostForUninstall(123, stop, () => {
      throw Object.assign(new Error("access denied"), { code: "EPERM" });
    }),
  ).rejects.toBe(failure);
  await expect(
    stopWindowsHostForUninstall(
      123,
      async () => {},
      () => {
        throw new Error("should not probe after successful shutdown");
      },
    ),
  ).resolves.toBe(true);
});

it("keeps paths and environment content from injecting service configuration", () => {
  const options = {
    directory: "/Users/a & b/%folder",
    port: 3774,
    executable: '/runtime/a"b/node',
    entry: "/runtime/$name/host.mjs",
  };
  const plist = launchAgent(options, "/bin:<test>&other");
  expect(plist).toContain("a&quot;b/node");
  expect(plist).toContain("/bin:&lt;test&gt;&amp;other");
  expect(plist).not.toContain("<test>");
  expect(plist).toContain("<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>");
  expect(plist).toContain("<key>RunAtLoad</key><true/>");
  const unit = systemdUnit(options, "/bin:/a\n[Service]\nExecStart=/bad");
  expect(unit.match(/^ExecStart=/gm)).toHaveLength(1);
  expect(unit).toContain("%%folder");
  expect(unit).toContain("$$name");
  expect(unit).toContain("KillMode=control-group");
});

it.each(["darwin", "linux"] as const)(
  "removes the %s service registration but keeps host data",
  async (platform) => {
    const home = mkdtempSync(join(tmpdir(), "bycoda-service-test-"));
    try {
      const service =
        platform === "darwin"
          ? join(home, "Library/LaunchAgents/com.bycoda.host.plist")
          : join(home, ".config/systemd/user/bycoda-host.service");
      const data = join(home, ".bycoda-host/host.db");
      for (const file of [service, data]) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "existing");
      }
      const calls: string[][] = [];
      const notes = await uninstallService({
        platform,
        home,
        uid: 501,
        run: async (command, args) => {
          calls.push([command, ...args]);
          if (args.includes("print"))
            throw new Error('Could not find service "com.bycoda.host" in domain for user gui: 501');
          if (args.includes("show"))
            return {
              stdout: `LoadState=${existsSync(service) ? "loaded" : "not-found"}\nActiveState=inactive\nUnitFileState=disabled\n`,
            };
        },
      });
      expect(existsSync(service)).toBe(false);
      expect(readFileSync(data, "utf8")).toBe("existing");
      if (platform === "darwin") expect(calls[0].slice(0, 2)).toEqual(["launchctl", "bootout"]);
      else {
        expect(calls).toContainEqual([
          "systemctl",
          "--user",
          "disable",
          "--now",
          "bycoda-host.service",
        ]);
        expect(notes.join("\n")).toContain("loginctl disable-linger");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

it.each(["darwin", "linux"] as const)(
  "preserves the %s definition and reports manager failures",
  async (platform) => {
    const home = mkdtempSync(join(tmpdir(), "bycoda-service-test-"));
    const file = join(
      home,
      platform === "darwin"
        ? "Library/LaunchAgents/com.bycoda.host.plist"
        : ".config/systemd/user/bycoda-host.service",
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "recovery configuration");
    try {
      await expect(
        uninstallService({
          platform,
          home,
          uid: 501,
          run: async () => {
            throw new Error("user bus unavailable / permission denied");
          },
        }),
      ).rejects.toThrow("definition was preserved");
      expect(readFileSync(file, "utf8")).toBe("recovery configuration");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

it.each(["darwin", "linux"] as const)(
  "does not remove the %s definition while the manager still owns a running job",
  async (platform) => {
    const home = mkdtempSync(join(tmpdir(), "bycoda-service-test-"));
    const file = join(
      home,
      platform === "darwin"
        ? "Library/LaunchAgents/com.bycoda.host.plist"
        : ".config/systemd/user/bycoda-host.service",
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "recovery configuration");
    try {
      await expect(
        uninstallService({
          platform,
          home,
          uid: 501,
          run: async () => ({
            stdout: "LoadState=loaded\nActiveState=active\nUnitFileState=enabled\n",
          }),
        }),
      ).rejects.toThrow("definition was preserved");
      expect(readFileSync(file, "utf8")).toBe("recovery configuration");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

it("restores the Linux definition if daemon-reload fails after removal", async () => {
  const home = mkdtempSync(join(tmpdir(), "bycoda-service-test-"));
  const file = join(home, ".config/systemd/user/bycoda-host.service");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "recovery configuration");
  try {
    await expect(
      uninstallService({
        platform: "linux",
        home,
        uid: 501,
        run: async (_command, args) => {
          if (args.includes("daemon-reload")) {
            expect(existsSync(file)).toBe(false);
            throw new Error("reload timeout");
          }
          return { stdout: "LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\n" };
        },
      }),
    ).rejects.toThrow("definition was preserved");
    expect(readFileSync(file, "utf8")).toBe("recovery configuration");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it.each(["darwin", "linux"] as const)(
  "allows a verified already-absent %s registration",
  async (platform) => {
    const home = mkdtempSync(join(tmpdir(), "bycoda-service-test-"));
    try {
      await expect(
        uninstallService({
          platform,
          home,
          uid: 501,
          run: async (_command, args) => {
            if (args.includes("bootout") || args.includes("disable")) throw new Error("not loaded");
            if (args.includes("print"))
              throw new Error(
                'Could not find service "com.bycoda.host" in domain for user gui: 501',
              );
            return { stdout: "LoadState=not-found\nActiveState=inactive\nUnitFileState=\n" };
          },
        }),
      ).resolves.toBeInstanceOf(Array);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

it("unregisters only this user's Windows task", async () => {
  const scripts: string[] = [];
  await uninstallService({
    platform: "win32",
    powershell: async (script) => scripts.push(script),
  });
  expect(scripts[0]).toContain('"Bycoda Host-$sid"');
  expect(scripts[0]).toContain("Unregister-ScheduledTask");
  expect(scripts[0]).not.toMatch(/Remove-Item|\.bycoda-host/);
});

it("unloads legacy KeepAlive only after the owning macOS host drains work", async () => {
  const events: string[] = [];
  let drained = false;
  let unloaded = false;
  await stopHostWithServicePolicy(
    123,
    async () => {
      events.push("drain");
      drained = true;
    },
    {
      platform: "darwin",
      uid: 501,
      run: async (_command, args) => {
        events.push(args[0]);
        expect(args[1]).toBe("gui/501/com.bycoda.host");
        if (args[0] === "bootout") {
          expect(drained).toBe(true);
          unloaded = true;
        }
        if (args[0] === "print") {
          if (unloaded)
            throw new Error('Could not find service "com.bycoda.host" in domain for user gui: 501');
          return { stdout: "\tpid = 123\n" };
        }
      },
    },
  );
  expect(events).toEqual(["print", "disable", "drain", "bootout", "print"]);
});

it("preserves crash recovery and never unloads a host that failed to drain", async () => {
  const events: string[] = [];
  await expect(
    stopHostWithServicePolicy(
      123,
      async () => {
        throw new Error("still draining");
      },
      {
        platform: "darwin",
        uid: 501,
        run: async (_command, args) => {
          events.push(args[0]);
          return { stdout: "pid = 123\n" };
        },
      },
    ),
  ).rejects.toThrow("still draining");
  expect(events).toEqual(["print", "disable", "enable"]);
});

it("does not disable a different registered macOS host when stopping a manual process", async () => {
  const events: string[] = [];
  await stopHostWithServicePolicy(
    123,
    async () => {
      events.push("stop manual");
    },
    {
      platform: "darwin",
      uid: 501,
      run: async (_command, args) => {
        events.push(args[0]);
        return { stdout: "pid = 456\n" };
      },
    },
  );
  expect(events).toEqual(["print", "stop manual"]);
});

it("reports failure when launchd retains the stopped legacy job", async () => {
  await expect(
    stopHostWithServicePolicy(123, async () => {}, {
      platform: "darwin",
      uid: 501,
      run: async () => ({ stdout: "pid = 123\n" }),
    }),
  ).rejects.toThrow("still has the stopped host registered");
});

it("does not stop the host when launchd restart suppression fails", async () => {
  let stopped = false;
  await expect(
    stopHostWithServicePolicy(
      123,
      async () => {
        stopped = true;
      },
      {
        platform: "darwin",
        uid: 501,
        run: async (_command, args) => {
          if (args[0] === "disable") throw new Error("permission denied");
          return { stdout: "pid = 123\n" };
        },
      },
    ),
  ).rejects.toThrow("permission denied");
  expect(stopped).toBe(false);
});

it.each(["win32", "linux"] as const)(
  "leaves %s graceful stop independent of launchd",
  async (platform) => {
    let stopped = false;
    await stopHostWithServicePolicy(
      123,
      async () => {
        stopped = true;
      },
      {
        platform,
        run: async () => {
          throw new Error("must not invoke a manager");
        },
      },
    );
    expect(stopped).toBe(true);
  },
);

it("restores the Linux definition when reload leaves a registered unit", async () => {
  const home = mkdtempSync(join(tmpdir(), "bycoda-service-test-"));
  const file = join(home, ".config/systemd/user/bycoda-host.service");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "recovery configuration");
  try {
    await expect(
      uninstallService({
        platform: "linux",
        home,
        uid: 501,
        run: async () => ({
          stdout: "LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\n",
        }),
      }),
    ).rejects.toThrow("definition was preserved");
    expect(readFileSync(file, "utf8")).toBe("recovery configuration");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
