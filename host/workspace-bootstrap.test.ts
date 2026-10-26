import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  WorkspaceBootstrapService,
  runBootstrapCommand,
  workspaceEnvironmentVariables,
  type BootstrapCommand,
} from "./workspace-bootstrap";
import { DevPortLeases } from "./dev-port-leases";

const roots: string[] = [];
const lock = "lockfileVersion: '9.0'\n";
const fingerprint = createHash("sha256").update(lock).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-bootstrap-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@12.15.0" }));
  await writeFile(join(root, "pnpm-lock.yaml"), lock);
  await mkdir(join(root, "src-tauri"));
  await writeFile(join(root, "src-tauri", "Cargo.lock"), "cargo lock");
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const request = {
  workspaceId: "workspace",
  lockfileFingerprint: fingerprint,
  idempotencyKey: "request",
};

it("deduplicates concurrent preparation by workspace and lock identity and uses pinned frozen pnpm without overriding its shared store", async () => {
  const root = await fixture();
  const run = vi.fn<BootstrapCommand>(async ({ args }) =>
    args[0] === "--version" ? "12.15.0" : "",
  );
  const service = new WorkspaceBootstrapService({
    resolveWorkspace: async () => root,
    runCommand: run,
  });
  const [one, two] = await Promise.all([
    service.prepare(request),
    service.prepare({ ...request, idempotencyKey: "other" }),
  ]);
  expect(one.id).toBe(two.id);
  expect(await service.wait(one.id)).toMatchObject({ state: "ready" });
  expect(run.mock.calls.map(([command]) => command.args)).toEqual([
    ["--version"],
    ["install", "--frozen-lockfile", "--prefer-offline"],
  ]);
  expect((await service.prepare(request)).id).toBe(one.id);
});

it("runs the pinned package manager against a real isolated workspace with a frozen lockfile", async () => {
  const root = await fixture();
  const initialLock =
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n";
  await writeFile(join(root, "pnpm-lock.yaml"), initialLock);
  // The pinned executable must not let its self-management shim rewrite source
  // metadata during a read-only version probe.
  await runBootstrapCommand({
    command: "pnpm",
    args: ["--version"],
    cwd: root,
    signal: new AbortController().signal,
  });
  const actualLock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  expect(actualLock).toBe(initialLock);
  const service = new WorkspaceBootstrapService({ resolveWorkspace: async () => root });
  const operation = await service.prepare({
    ...request,
    lockfileFingerprint: createHash("sha256").update(actualLock).digest("hex"),
  });
  const result = await service.wait(operation.id);
  expect(result, result.error?.code).toMatchObject({ state: "ready" });
  expect(await readFile(join(root, "pnpm-lock.yaml"), "utf8")).toBe(actualLock);
}, 30_000);

it("cancels active preparation, awaits its child settlement, then permits an explicit retry", async () => {
  const root = await fixture();
  let started!: () => void;
  const installing = new Promise<void>((done) => {
    started = done;
  });
  const run: BootstrapCommand = async ({ args, signal }) => {
    if (args[0] === "--version") return "12.15.0";
    started();
    await new Promise<void>((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
    return "";
  };
  const service = new WorkspaceBootstrapService({
    resolveWorkspace: async () => root,
    runCommand: run,
  });
  const first = await service.prepare(request);
  await installing;
  expect(await service.cancel(first.id)).toMatchObject({ state: "cancelled" });
  const retried = await service.prepare({ ...request, idempotencyKey: "retry" });
  expect(retried.id).not.toBe(first.id);
  // A retry can also be cancelled while resolving its workspace.
  await service.cancel(retried.id);
});

it("rejects stale locks, package-manager mismatches and dependency junctions before install", async () => {
  const root = await fixture();
  const run = vi.fn<BootstrapCommand>(async () => "12.14.0");
  let service = new WorkspaceBootstrapService({
    resolveWorkspace: async () => root,
    runCommand: run,
  });
  let result = await service.prepare({ ...request, lockfileFingerprint: "stale" });
  expect(await service.wait(result.id)).toMatchObject({
    state: "failed",
    error: { code: "LOCKFILE_CHANGED" },
  });
  result = await service.prepare({ ...request, idempotencyKey: "current" });
  expect(await service.wait(result.id)).toMatchObject({
    state: "failed",
    error: { code: "PNPM_VERSION_MISMATCH" },
  });
  const target = await fixture();
  await symlink(
    target,
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  service = new WorkspaceBootstrapService({ resolveWorkspace: async () => root, runCommand: run });
  result = await service.prepare(request);
  expect(await service.wait(result.id)).toMatchObject({
    state: "failed",
    error: { code: "NODE_MODULES_LINK" },
  });
  expect(run).toHaveBeenCalledTimes(1);
});

it("detects lockfile changes during installation without exposing installer diagnostics", async () => {
  const root = await fixture();
  const service = new WorkspaceBootstrapService({
    resolveWorkspace: async () => root,
    runCommand: async ({ args }) => {
      if (args[0] === "--version") return "12.15.0";
      await writeFile(join(root, "pnpm-lock.yaml"), "changed");
      return "token=secret";
    },
  });
  const result = await service.prepare(request);
  expect(await service.wait(result.id)).toMatchObject({
    state: "failed",
    error: { code: "LOCKFILE_CHANGED" },
  });
  expect(JSON.stringify(await service.status(result.id))).not.toContain("secret");
});

it("isolates two runs and serializes keyed shared build outputs before copying immutable executables", async () => {
  const root = await fixture();
  const secondRoot = await fixture();
  const cacheRoot = join(root, "shared-cache");
  const waits: string[] = [];
  const service = new WorkspaceBootstrapService({
    resolveWorkspace: async (id) => (id === "workspace" ? root : secondRoot),
    sharedCargoTargetRoot: cacheRoot,
    toolchain: "rustc-version-1",
    buildLeasePollMs: 10,
    onBuildCacheState: (_, state) => waits.push(state),
  });
  const leases = new DevPortLeases();
  const onePorts = await leases.acquire({
    workspaceId: "workspace",
    runId: "one",
    kinds: ["vite", "host"],
  });
  const twoPorts = await leases.acquire({
    workspaceId: "other",
    runId: "two",
    kinds: ["vite", "host"],
  });
  try {
    const one = await service.devEnvironment({
      workspaceId: "workspace",
      runId: "one",
      ports: onePorts,
    });
    const two = await service.devEnvironment({
      workspaceId: "other",
      runId: "two",
      ports: twoPorts,
    });
    expect(one.cargoTargetDir).toBe(two.cargoTargetDir);
    expect(one.hostDataPath).not.toBe(two.hostDataPath);
    expect(one.desktopDataPath).not.toBe(two.desktopDataPath);
    expect(one.instanceId).not.toBe(two.instanceId);
    expect(workspaceEnvironmentVariables(one)).toMatchObject({
      BYCODA_HOST_DIR: one.hostDataPath,
      BYCODA_DEV_PROFILE_ID: one.instanceId,
    });
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    const controller = new AbortController();
    const first = service.withBuildCache(
      "workspace",
      controller.signal,
      async ({ cargoTargetDir }) => {
        entered();
        await blocked;
        const source = join(cargoTargetDir, "bycoda.exe");
        await writeFile(source, "completed executable");
        return service.copyExecutable({
          workspaceId: "workspace",
          runId: "one",
          sourcePath: source,
        });
      },
    );
    await ready;
    let secondEntered = false;
    const second = service.withBuildCache("other", controller.signal, async () => {
      secondEntered = true;
    });
    await vi.waitFor(() => expect(waits).toContain("waitingForBuildCache"));
    expect(secondEntered).toBe(false);
    release();
    const copied = await first;
    await second;
    expect(await readFile(copied, "utf8")).toBe("completed executable");
    expect(copied).toContain(one.executableRunDir);
    await expect(
      service.copyExecutable({
        workspaceId: "workspace",
        runId: "one",
        sourcePath: join(one.cargoTargetDir, "bycoda.exe"),
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  } finally {
    await leases.release(onePorts.id);
    await leases.release(twoPorts.id);
  }
});

it("cancels a queued cross-process build lease without entering or removing the holder's lock", async () => {
  const root = await fixture();
  const service = new WorkspaceBootstrapService({
    resolveWorkspace: async () => root,
    buildLeasePollMs: 10,
  });
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((done) => {
    entered = done;
  });
  const first = service.withBuildCache("workspace", new AbortController().signal, async () => {
    entered();
    await new Promise<void>((done) => {
      release = done;
    });
  });
  await enteredPromise;
  const build = vi.fn(async () => {});
  const waiting = service.withBuildCache("workspace", controller.signal, build);
  controller.abort();
  await expect(waiting).rejects.toBeDefined();
  expect(build).not.toHaveBeenCalled();
  release();
  await first;
});
