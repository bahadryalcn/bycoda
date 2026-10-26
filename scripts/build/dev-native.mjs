#!/usr/bin/env node
/**
 * pnpm dev:native [--bootstrap] [--workspace-id ID] [--run-id ID]
 *                 [--shared-target ABSOLUTE_CACHE_ROOT]
 * Builds a debug executable, copies it under this workspace, then supervises an
 * isolated Host/Vite/native run. Ctrl+C stops only this supervisor's children.
 * No services or installers are used. Node 24+, pinned pnpm and Rust are required.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DevPortLeases } from "../../host/dev-port-leases.ts";
import {
  WorkspaceBootstrapService,
  workspaceEnvironmentVariables,
} from "../../host/workspace-bootstrap.ts";
import { sourceIdentity } from "./build-info.mjs";
import { chromium } from "@playwright/test";
import { verifyNativeIdentity } from "./dev-shot.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const option = (args, key, fallback) => {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${key} value`);
  return args[index + 1];
};

export function nativeDevConfig(base, environment) {
  const port = Number(environment.BYCODA_VITE_PORT);
  const hmr = Number(environment.BYCODA_HMR_PORT);
  if (![port, hmr].every((value) => Number.isInteger(value) && value >= 1024 && value <= 65535))
    throw new Error("Development ports are required");
  const config = {
    build: { devUrl: `http://127.0.0.1:${port}`, beforeDevCommand: "" },
    app: { security: {} },
  };
  const original = base.app?.security?.devCsp;
  if (typeof original !== "string") throw new Error("Expected the maintained debug CSP");
  config.app.security.devCsp = original
    .replace(/(?:http|ws):\/\/(?:localhost|127\.0\.0\.1):142[01]\b/g, "")
    .replace(
      "connect-src ",
      `connect-src http://127.0.0.1:${port} http://localhost:${port} ws://127.0.0.1:${hmr} ws://localhost:${hmr} `,
    );
  return config;
}

export function supervisedChild(command, args, { cwd, env, children }) {
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.failure = "";
  child.spawnError = null;
  child.on("error", (error) => {
    child.spawnError = error;
  });
  child.stdout.on("data", (chunk) => {
    child.failure = (child.failure + chunk).slice(-8192);
  });
  child.stderr.on("data", (chunk) => {
    child.failure = (child.failure + chunk).slice(-8192);
  });
  children.add(child);
  child.closed = new Promise((done) =>
    child.once("close", () => {
      children.delete(child);
      done();
    }),
  );
  return child;
}

function assertRunning(child) {
  if (child.spawnError) throw child.spawnError;
  if (child.exitCode !== null || child.signalCode !== null) {
    const race = /EADDRINUSE|address already in use|port .{0,30}(?:already in use|occupied)/i.test(
      child.failure,
    );
    throw Object.assign(
      new Error(
        race
          ? "Development port bind race"
          : `Development child exited (${child.exitCode ?? child.signalCode})`,
      ),
      { code: race ? "EADDRINUSE" : "CHILD_EXITED" },
    );
  }
}

export async function completed(child) {
  // The close promise is installed at spawn time, including for very fast tools.
  await child.closed;
  if (child.spawnError) throw child.spawnError;
  if (child.exitCode !== 0) throw new Error(`Build command failed (${child.exitCode})`);
  return child.failure.trim();
}

export async function stopChildren(children) {
  await Promise.all(
    [...children].map(async (child) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        await child.closed;
        return;
      }
      if (process.platform === "win32") {
        await new Promise((done) => {
          const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.once("error", done);
          killer.once("close", done);
        });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
      await Promise.race([child.closed, sleep(2_000)]);
      if (process.platform !== "win32") {
        // Settle any descendant that ignored SIGTERM even when its parent exited.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* owned group already settled */
        }
      }
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else child.kill();
        await child.closed;
      }
    }),
  );
}

async function waitFor(child, ready, signal, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    assertRunning(child);
    if (await ready().catch(() => false)) {
      assertRunning(child);
      return;
    }
    await sleep(100);
  }
  throw new Error("Development child readiness timed out");
}

export async function runNativeDev(args = process.argv.slice(2)) {
  const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const workspaceId = option(args, "--workspace-id", hash(root));
  const runId = option(args, "--run-id", randomUUID());
  const abort = new AbortController();
  const children = new Set();
  const launch = (command, parameters, env = process.env) =>
    supervisedChild(command, parameters, { cwd: root, env, children });
  const cancel = () => {
    abort.abort();
    void stopChildren(children);
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const leases = new DevPortLeases();
  let lease;
  try {
    const toolchain = await completed(launch("rustc", ["-vV"]));
    const bootstrap = new WorkspaceBootstrapService({
      resolveWorkspace: async () => root,
      sharedCargoTargetRoot: option(args, "--shared-target", undefined),
      toolchain,
      onBuildCacheState: (_workspace, state) =>
        console.log(
          state === "waitingForBuildCache"
            ? "Waiting for build cache…"
            : "Building native debug executable…",
        ),
    });
    if (args.includes("--bootstrap")) {
      const preparation = await bootstrap.prepare({
        workspaceId,
        lockfileFingerprint: hash(await readFile(join(root, "pnpm-lock.yaml"))),
        idempotencyKey: runId,
      });
      const cancelPreparation = () => {
        void bootstrap.cancel(preparation.id);
      };
      abort.signal.addEventListener("abort", cancelPreparation, { once: true });
      if (abort.signal.aborted) cancelPreparation();
      const status = await bootstrap.wait(preparation.id);
      abort.signal.removeEventListener("abort", cancelPreparation);
      if (status.state !== "ready")
        throw new Error(status.error?.message ?? "Workspace preparation cancelled");
    } else if (!existsSync(join(root, "node_modules")))
      throw new Error("Run pnpm dev:native --bootstrap to prepare this workspace explicitly");
    if ((await lstat(join(root, "node_modules"))).isSymbolicLink())
      throw new Error("Workspace node_modules must not be a junction or symlink");
    const base = JSON.parse(await readFile(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
    for (let attempt = 0; attempt < 3; attempt++) {
      lease = await leases.acquire({
        workspaceId,
        runId: attempt ? `${runId}-${attempt}` : runId,
        kinds: ["vite", "hmr", "host", "cdp"],
      });
      const environment = await bootstrap.devEnvironment({
        workspaceId,
        runId: lease.runId,
        ports: lease,
      });
      const env = {
        ...process.env,
        ...workspaceEnvironmentVariables(environment),
        TAURI_DEV_HOST: "127.0.0.1",
        BYCODA_DEV_HOST_ENTRY: join(root, "build", "host", "bycoda-host.mjs"),
        BYCODA_DEV_NODE_EXECUTABLE: process.execPath,
      };
      const source = await sourceIdentity(root);
      const buildId = `dev-${Date.now()}-${hash(`${workspaceId}/${lease.runId}`).slice(0, 12)}`;
      const manifest = {
        schemaVersion: 1,
        buildId,
        version: base.version,
        channel: "dev",
        mode: "debug",
        ...source,
        capturedAt: Date.now(),
        components: { web: buildId, native: buildId, host: buildId },
        includedSources: [{ repositoryId: source.repositoryId, sourceHead: source.head }],
      };
      env.BYCODA_BUILD_MANIFEST = join(dirname(environment.executableRunDir), "build-info.json");
      await writeFile(env.BYCODA_BUILD_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: "wx",
      });
      env.TAURI_CONFIG = JSON.stringify(nativeDevConfig(base, env));
      try {
        await completed(launch(process.execPath, [join(root, "host", "build.mjs")], env));
        const hostRuntime = join(dirname(environment.executableRunDir), "host-runtime");
        await cp(join(root, "build", "host"), hostRuntime, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        await writeFile(
          join(hostRuntime, "version.json"),
          `${JSON.stringify({ version: base.version, buildIdentity: manifest })}\n`,
        );
        env.BYCODA_DEV_HOST_ENTRY = join(hostRuntime, "bycoda-host.mjs");
        const executable = await bootstrap.withBuildCache(
          workspaceId,
          abort.signal,
          async ({ cargoTargetDir, cargoHome }) => {
            await completed(
              launch("cargo", ["build", "--manifest-path", join(root, "src-tauri", "Cargo.toml")], {
                ...env,
                CARGO_TARGET_DIR: cargoTargetDir,
                CARGO_HOME: cargoHome,
              }),
            );
            return bootstrap.copyExecutable({
              workspaceId,
              runId: lease.runId,
              sourcePath: join(
                cargoTargetDir,
                "debug",
                process.platform === "win32" ? "bycoda.exe" : "bycoda",
              ),
            });
          },
        );
        if (JSON.stringify(await sourceIdentity(root)) !== JSON.stringify(source))
          throw new Error(
            "Source changed during native build; restart this run to capture the current source",
          );
        await leases.handoff(lease.id, ["vite", "hmr"]);
        const vite = launch(
          process.execPath,
          [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1"],
          env,
        );
        await waitFor(
          vite,
          async () => (await fetch(environment.devUrl, { signal: AbortSignal.timeout(800) })).ok,
          abort.signal,
        );
        await leases.handoff(lease.id, ["host"]);
        const host = launch(
          process.execPath,
          [
            env.BYCODA_DEV_HOST_ENTRY,
            "serve",
            "--data-dir",
            environment.hostDataPath,
            "--port",
            String(lease.ports.host),
          ],
          env,
        );
        await waitFor(
          host,
          async () => {
            const state = JSON.parse(
              await readFile(join(environment.hostDataPath, "running.json"), "utf8"),
            );
            return state.pid === host.pid && state.port === lease.ports.host;
          },
          abort.signal,
        );
        await leases.handoff(lease.id, ["cdp"]);
        const native = launch(executable, [], env);
        if (process.platform === "win32") {
          try {
            await waitFor(
              native,
              async () => {
                const targets = await (
                  await fetch(`http://127.0.0.1:${lease.ports.cdp}/json/list`, {
                    signal: AbortSignal.timeout(800),
                  })
                ).json();
                return (
                  Array.isArray(targets) &&
                  targets.some((target) => {
                    try {
                      return new URL(target.url).origin === environment.devUrl;
                    } catch {
                      return false;
                    }
                  })
                );
              },
              abort.signal,
            );
            const browser = await chromium.connectOverCDP(`http://127.0.0.1:${lease.ports.cdp}`, {
              timeout: 5_000,
            });
            try {
              const page = browser
                .contexts()
                .flatMap((context) => context.pages())
                .find((page) => {
                  try {
                    return new URL(page.url()).origin === environment.devUrl;
                  } catch {
                    return false;
                  }
                });
              if (!page) throw new Error("The CDP page belongs to a different run");
              try {
                await verifyNativeIdentity(page, manifest);
              } catch {
                throw Object.assign(new Error("The CDP app identity belongs to a different run"), {
                  code: "EADDRINUSE",
                });
              }
            } finally {
              await browser.close();
            }
          } catch (error) {
            if (
              error.message === "Development child readiness timed out" &&
              (await fetch(`http://127.0.0.1:${lease.ports.cdp}/json/version`, {
                signal: AbortSignal.timeout(800),
              })
                .then((response) => response.ok)
                .catch(() => false))
            ) {
              throw Object.assign(new Error("The selected CDP port belongs to a different run"), {
                code: "EADDRINUSE",
              });
            }
            throw error;
          }
        }
        const record = {
          schemaVersion: 1,
          ...environment,
          pid: native.pid,
          executable,
          capturedAt: Date.now(),
          buildManifest: env.BYCODA_BUILD_MANIFEST,
        };
        const recordPath = join(dirname(environment.executableRunDir), "dev-run.json");
        await mkdir(dirname(recordPath), { recursive: true });
        await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
        console.log(`Native development ready. Run record: ${recordPath}`);
        while (native.exitCode === null && native.signalCode === null) {
          abort.signal.throwIfAborted();
          assertRunning(vite);
          assertRunning(host);
          assertRunning(native);
          await sleep(200);
        }
        return record;
      } catch (error) {
        await stopChildren(children);
        if (error.code !== "EADDRINUSE" || attempt === 2) throw error;
        console.log("Development bind race; allocating fresh ports…");
      } finally {
        await leases.release(lease.id);
        lease = undefined;
      }
    }
  } catch (error) {
    if (abort.signal.aborted) throw abort.signal.reason;
    throw error;
  } finally {
    if (lease) await leases.release(lease.id);
    await stopChildren(children);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help"))
    console.log(
      "pnpm dev:native [--bootstrap] [--workspace-id ID] [--run-id ID] [--shared-target ABSOLUTE_CACHE_ROOT]\nBuild and supervise an isolated debug app, Host and Vite run. Ctrl+C cancels this run.",
    );
  else
    runNativeDev().catch((error) => {
      console.error(error.name === "AbortError" ? "Development run cancelled" : error.message);
      process.exitCode = error.name === "AbortError" ? 0 : 1;
    });
}
