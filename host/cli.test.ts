import { expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type AddressInfo } from "node:net";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { acquireHostOwner } from "./owner";

const exec = promisify(execFile);

// An exited Host stays a zombie until its reaper collects it. Minimal container
// inits reap lazily (about 2s), and kill(pid, 0) still succeeds for a zombie.
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true;
  }
}

it(
  "starts detached, authenticates a device, revokes it, and stops independently of the launcher",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-cli-test-"));
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    // Reproduce a provider/native handle left behind after graceful cleanup.
    const cli = join(directory, "host.mjs");
    const sourceBundle = resolve(process.env.BYCODA_HOST_TEST_CLI ?? "build/host/bycoda-host.mjs");
    writeFileSync(
      cli,
      readFileSync(sourceBundle, "utf8") +
        '\nif (process.argv[2] === "serve") setInterval(() => {}, 60_000);\n',
    );
    // The detached bundle resolves SQLite and Notes workers relative to itself.
    for (const sidecar of [
      "store-worker.mjs",
      "host-notes-worker.mjs",
      "provider-guard.mjs",
      "workspace-cleanup-worker.mjs",
    ]) {
      copyFileSync(join(dirname(sourceBundle), sidecar), join(directory, sidecar));
    }
    const run = (...args: string[]) =>
      exec(process.execPath, [cli, ...args, "--data-dir", directory, "--port", String(port)], {
        timeout: process.platform === "win32" ? 25_000 : 10_000,
        windowsHide: true,
        env: {
          ...process.env,
          HOME: join(directory, "home"),
          USERPROFILE: join(directory, "home"),
          APPDATA: join(directory, "home", "AppData", "Roaming"),
          LOCALAPPDATA: join(directory, "home", "AppData", "Local"),
        },
      });
    try {
      mkdirSync(join(directory, "home", "AppData", "Roaming"), { recursive: true });
      mkdirSync(join(directory, "home", "AppData", "Local"), { recursive: true });
      // Only confirmed process absence permits reclaiming a legacy sentinel.
      const departedPid = 2_147_483_647;
      expect(() => process.kill(departedPid, 0)).toThrow();
      writeFileSync(join(directory, "owner.lock"), String(departedPid));
      expect((await run("start")).stdout).toContain("Host started");
      expect((await run("status")).stdout).toContain("Host is running");
      const refused = await run("serve").then(
        () => undefined,
        (error: { message: string; code?: number; killed?: boolean }) => error,
      );
      expect(refused?.message).toContain("A host already owns");
      // The fixture leaks a handle. A refused starter must still exit by itself, or its
      // service supervisor would never restart it.
      expect(refused).toMatchObject({ code: 1, killed: false });
      const before = JSON.parse((await run("connection-info")).stdout);
      const runningPath = join(directory, "running.json");
      // Check the modes the Host wrote before the fixture below replaces running.json.
      if (process.platform !== "win32") {
        expect(statSync(directory).mode & 0o777).toBe(0o700);
        expect(statSync(runningPath).mode & 0o777).toBe(0o600);
      }
      const originalRunning = readFileSync(runningPath);
      try {
        const stalled = createServer((socket) => socket.resume());
        await new Promise<void>((resolve, reject) => {
          stalled.once("error", reject);
          stalled.listen(0, "127.0.0.1", resolve);
        });
        try {
          const state = JSON.parse(originalRunning.toString("utf8"));
          state.port = (stalled.address() as AddressInfo).port;
          writeFileSync(runningPath, JSON.stringify(state));
          await expect(run("status")).rejects.toThrow("still owns");
        } finally {
          await new Promise<void>((resolve) => stalled.close(() => resolve()));
        }
        writeFileSync(runningPath, "{broken");
        await expect(run("status")).rejects.toThrow("still owns");
        await expect(run("stop")).rejects.toThrow("still owns");
        expect(readFileSync(runningPath, "utf8")).toBe("{broken");
        rmSync(runningPath);
        await expect(run("status")).rejects.toThrow("still owns");
      } finally {
        // The test process has a default umask; keep the secret-bearing file private.
        writeFileSync(runningPath, originalRunning, { mode: 0o600 });
        if (process.platform !== "win32") chmodSync(runningPath, 0o600);
      }
      expect((await run("status")).stdout).toContain("Host is running");
      // Connecting to an existing host must not install a service or restart it.
      expect(JSON.parse((await run("service", "install")).stdout)).toEqual(before);
      const device = JSON.parse((await run("pair", "--name", "Test laptop")).stdout) as {
        id: string;
        token: string;
        environmentId: string;
      };
      const describe = () =>
        fetch(`http://127.0.0.1:${port}/rpc`, {
          method: "POST",
          headers: { Authorization: `Bearer ${device.token}` },
          body: JSON.stringify({
            version: 1,
            method: "environment.describe",
            params: {},
          }),
        });
      const response = await describe();
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { result: { environmentId: string } }).result.environmentId,
      ).toBe(device.environmentId);
      await run("revoke", device.id);
      await expect(run("revoke", device.id)).rejects.toThrow("Device not found");
      // This CLI is a separate SQLite writer. The running Host checks external
      // credential changes when its documented 1.5s positive cache expires.
      await vi.waitFor(async () => expect((await describe()).status).toBe(401), {
        timeout: 5_000,
        interval: 100,
      });
      expect((await run("stop")).stdout).toContain("Host is stopping");
      await vi.waitFor(() => expect(existsSync(join(directory, "running.json"))).toBe(false));
      await vi.waitFor(() => expect(processIsAlive(before.pid)).toBe(false), { timeout: 5_000 });
      expect((await run("status")).stdout).toContain("Host is stopped");
    } finally {
      if (existsSync(join(directory, "running.json"))) {
        const state = JSON.parse(readFileSync(join(directory, "running.json"), "utf8")) as {
          pid: number;
        };
        try {
          await run("stop");
        } catch {
          try {
            process.kill(state.pid, "SIGTERM");
          } catch {
            /* gone */
          }
        }
        await vi.waitFor(() => expect(existsSync(join(directory, "running.json"))).toBe(false));
      }
      // Windows can retain a short-lived handle after the detached host exits.
      // Retry transient locks, but still fail if fixture cleanup cannot finish.
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
  // Each unreachable-owner probe waits 5s, so POSIX runs take over 10s before CI load.
  process.platform === "win32" ? 60_000 : 45_000,
);

it(
  "refuses a second starter before it opens the database",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-cli-owner-"));
    const sourceBundle = resolve(process.env.BYCODA_HOST_TEST_CLI ?? "build/host/bycoda-host.mjs");
    const cli = join(directory, "host.mjs");
    copyFileSync(sourceBundle, cli);
    for (const sidecar of ["store-worker.mjs", "host-notes-worker.mjs"])
      copyFileSync(join(dirname(sourceBundle), sidecar), join(directory, sidecar));
    for (const folder of ["Roaming", "Local"])
      mkdirSync(join(directory, "home", "AppData", folder), { recursive: true });
    // This process stands in for a Host that is still starting: it holds the lease and
    // has written no lifecycle state yet.
    const release = await acquireHostOwner(directory);
    try {
      const refused = await exec(
        process.execPath,
        [cli, "serve", "--data-dir", directory, "--port", "1"],
        {
          timeout: process.platform === "win32" ? 25_000 : 10_000,
          windowsHide: true,
          env: {
            ...process.env,
            HOME: join(directory, "home"),
            USERPROFILE: join(directory, "home"),
            APPDATA: join(directory, "home", "AppData", "Roaming"),
            LOCALAPPDATA: join(directory, "home", "AppData", "Local"),
          },
        },
      ).then(
        () => undefined,
        (error: { message: string; code?: number; killed?: boolean }) => error,
      );
      expect(refused?.message).toContain("A host already owns");
      expect(refused).toMatchObject({ code: 1, killed: false });
      expect(existsSync(join(directory, "host.db"))).toBe(false);
      expect(existsSync(join(directory, "running.json"))).toBe(false);
    } finally {
      release();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
  process.platform === "win32" ? 40_000 : 20_000,
);
