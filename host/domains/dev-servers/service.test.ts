import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { spawn, ChildProcess, SpawnOptions } from "node:child_process";
import { DevServersService, type DevServerProcessDiscovery } from "../../dev-servers";
import { DevPortLeases } from "../../dev-port-leases";
import { DevServerAccess } from "../../dev-server-access";
import * as dto from "../../../src/shared/model/host-contracts/dev-servers";
import { createDevServersService, type DevServersContext } from "./service";

const net = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:net", async (original) => ({
  ...(await original<typeof import("node:net")>()),
  createConnection: (...args: unknown[]) => net.connect(...args),
}));
type Process = NonNullable<dto.HostDevServer["process"]>;
const endpoint = (port: number) => ({
  address: "127.0.0.1",
  port,
  url: `http://127.0.0.1:${port}`,
});
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  net.connect.mockReset();
});

class Discovery implements DevServerProcessDiscovery {
  live = new Map<number, Process>();
  ports = new Map<number, ReturnType<typeof endpoint>[]>();
  listeners = vi.fn(async () =>
    [...this.live.values()]
      .filter((entry) => this.ports.has(entry.pid))
      .map((entry) => ({ process: { ...entry }, endpoints: this.ports.get(entry.pid)! })),
  );
  processes = vi.fn(async () => [...this.live.values()].map((entry) => ({ ...entry })));
  identity = vi.fn(async (pid: number) => this.live.get(pid));
  signal = vi.fn(async (identity: { pid: number; startedAt: string }, _force: boolean) => {
    this.live.delete(identity.pid);
    this.ports.delete(identity.pid);
  });
  invalidate = vi.fn();
}
class PortLeases extends DevPortLeases {
  override acquire = vi.fn(async (request: Parameters<DevPortLeases["acquire"]>[0]) => ({
    id: "lease",
    workspaceId: request.workspaceId,
    runId: request.runId,
    ports: { vite: 4301, hmr: 4302, host: 4303, cdp: 4304 },
  }));
  override handoff = vi.fn(async (_id: string) => {});
  override release = vi.fn(async (_id: string) => {});
}
function fixture(
  options: { maxConcurrent?: number; startActivity?: () => Promise<() => Promise<void>> } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "bycoda-dev-domain-"));
  const project = join(root, "project"),
    worktree = join(project, "worktree");
  mkdirSync(worktree, { recursive: true });
  cleanups.push(() => {
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    expect(root).toContain("bycoda-dev-domain-");
    rmSync(root, { recursive: true, force: true });
  });
  const discovery = new Discovery(),
    portLeases = new PortLeases();
  discovery.live.set(101, {
    pid: 101,
    startedAt: "birth.101",
    name: "node",
    command: "node existing.js",
    cwd: project,
  });
  discovery.ports.set(101, [endpoint(3101)]);
  const children: ChildProcess[] = [];
  const spawnProcess = vi.fn((_file: string, _args: readonly string[], settings: SpawnOptions) => {
    const pid = 202 + children.length;
    discovery.live.set(pid, {
      pid,
      startedAt: `birth.${pid}`,
      name: "node",
      command: "fixture dev",
      cwd: String(settings.cwd),
    });
    discovery.ports.set(pid, [endpoint(Number(settings.env?.BYCODA_VITE_PORT ?? 4301))]);
    const child = Object.assign(new EventEmitter(), {
      pid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
    children.push(child);
    return child;
  });
  cleanups.push(() => {
    for (const child of children) {
      child.emit("close", 0);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  });
  const release = vi.fn(async () => {});
  const owner = new DevServersService({
    discovery,
    spawnProcess: spawnProcess as unknown as typeof spawn,
    portLeases,
    shellProfile: null,
    graceMs: 0,
    cacheMs: 0,
    startActivity: options.startActivity ?? (async () => release),
    ...options,
  });
  const handle = vi.spyOn(owner, "handle");
  const context: DevServersContext = {
    authorized: vi.fn(async () => true),
    principalId: "paired.device",
  };
  const projects = [{ id: "project", name: "Project", cwd: project }];
  const ports = {
    servers: owner,
    project: vi.fn(async (id: string) => {
      if (id !== "project") throw new Error("Project is not registered");
      return projects[0];
    }),
    projects: vi.fn(async () => projects),
    workspace: vi.fn(async (_id: unknown) => ({
      id: "workspace",
      projectId: "project",
      path: worktree,
    })),
    assertWorkspaceWritable: vi.fn(async (_id: string) => {}),
    openExternal: vi.fn(async (url: string, _context: unknown, authorize: () => Promise<void>) => {
      await authorize();
      return { url };
    }),
  };
  const service = createDevServersService(ports);
  const selected = async () =>
    dto.DevServersListResultSchema.parse(
      await service.list({ projectId: "project" }, context),
    ).servers.find((entry) => entry.process?.pid === 101)!;
  const target = async () => {
    const server = await selected();
    return { projectId: "project", id: server.id, identity: server.process, tree: false };
  };
  return {
    root,
    project,
    worktree,
    discovery,
    portLeases,
    spawnProcess,
    children,
    release,
    owner,
    handle,
    context,
    ports,
    service,
    selected,
    target,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("preserves owner discovery, complete process identities and strict WS versus tolerant V1 outer fields", async () => {
  const f = fixture(),
    target = await f.target();
  const identity = { ...target.identity!, reviewMetadata: { nested: ["preserved"] } };
  dto.DevServersDetailsResultSchema.parse(
    await f.service.details({ ...target, identity }, f.context),
  );
  expect(f.handle.mock.calls.at(-1)?.[1].identity).toEqual(identity);
  await expect(
    f.service.list(
      { projectId: "project", futureConfig: { permissions: { inherited: true } } },
      f.context,
    ),
  ).rejects.toThrow();
  const raw = { ...target, futureConfig: { permissions: { inherited: true } } };
  await f.service.details(raw, f.context, { legacy: true });
  expect(f.handle.mock.calls.at(-1)?.[1]).toBe(raw);
  await expect(f.service.list({ projectId: "other" }, f.context)).rejects.toThrow("registered");
  expect(f.spawnProcess).not.toHaveBeenCalled();
});

it("retains unidentified listeners in the concrete result without granting process signals", async () => {
  const f = fixture();
  f.discovery.live.set(0, { pid: 0, startedAt: "", name: "unidentified" });
  f.discovery.ports.set(0, [endpoint(3105)]);
  const list = dto.DevServersListResultSchema.parse(
    await f.service.list({ projectId: "project" }, f.context),
  );
  const unknown = list.servers.find((entry) => entry.process?.pid === 0)!;
  expect(unknown.association).toBe("uncertain");
  expect(unknown.endpoints[0].port).toBe(3105);
  await expect(
    f.service.stop({ projectId: "project", id: unknown.id, identity: unknown.process }, f.context),
  ).rejects.toThrow("identity");
  expect(f.discovery.signal).not.toHaveBeenCalled();
});

it("routes explicit workspace launches through the registered owner path, idle gate and allocated environment", async () => {
  const f = fixture();
  const result = dto.DevServersStartRpcResultSchema.parse(
    await f.service.start(
      {
        projectId: "project",
        workspaceId: "workspace",
        runId: "run",
        command: "pnpm dev",
        cwd: "/untrusted-override",
        expectedPort: 5000,
      },
      f.context,
    ),
  );
  expect(result).toHaveProperty("lease");
  expect(f.ports.assertWorkspaceWritable).toHaveBeenCalledWith("workspace");
  const settings = f.spawnProcess.mock.calls[0][2];
  expect(settings.cwd).toBe(f.worktree);
  expect(settings.windowsHide).toBe(true);
  expect(settings.env?.BYCODA_VITE_PORT).toBe("4301");
  expect(settings.env?.BYCODA_HMR_PORT).toBe("4302");
  expect(settings.env?.BYCODA_DEV_HOST_PORT).toBe("4303");
  expect(settings.env?.BYCODA_WEBVIEW_DEBUG_PORT).toBe("4304");
  expect(f.portLeases.acquire.mock.calls[0][0].kinds).toEqual(["vite", "hmr", "host", "cdp"]);
  expect(f.release).not.toHaveBeenCalled();
  f.ports.workspace.mockResolvedValue({ id: "foreign", projectId: "other", path: f.worktree });
  await expect(
    f.service.start({ projectId: "project", workspaceId: "foreign", command: "dev" }, f.context),
  ).rejects.toThrow("another project");
  expect(f.spawnProcess).toHaveBeenCalledTimes(1);
});

it("keeps workspace reservations and activity authorization ahead of process creation", async () => {
  const f = fixture();
  f.ports.assertWorkspaceWritable.mockRejectedValue(new Error("Workspace reservation is active"));
  await expect(
    f.service.start({ projectId: "project", workspaceId: "workspace", command: "dev" }, f.context),
  ).rejects.toThrow("reservation");
  expect(f.spawnProcess).not.toHaveBeenCalled();
  expect(f.portLeases.acquire).not.toHaveBeenCalled();
  const activity = deferred(),
    entered = deferred();
  const g = fixture({
    startActivity: async () => {
      entered.resolve();
      await activity.promise;
      return async () => {};
    },
  });
  const result = g.service.start({ projectId: "project", command: "dev" }, g.context);
  await entered.promise;
  vi.mocked(g.context.authorized).mockResolvedValue(false);
  activity.resolve();
  await expect(result).rejects.toThrow("revoked");
  expect(g.spawnProcess).not.toHaveBeenCalled();
});

it("rechecks the actual owner queue admission after a grant is revoked while waiting", async () => {
  const f = fixture({ maxConcurrent: 1 }),
    entered = deferred(),
    gate = deferred();
  const listeners = f.discovery.listeners.getMockImplementation()!;
  f.discovery.listeners.mockImplementationOnce(async () => {
    entered.resolve();
    await gate.promise;
    return listeners();
  });
  const blocking = f.owner.handle("devServers.list", {}, [
    { id: "project", name: "Project", path: f.project },
  ]);
  await entered.promise;
  const queued = f.service.start({ projectId: "project", command: "dev" }, f.context);
  await vi.waitFor(() =>
    expect(f.handle.mock.calls.some(([method]) => method === "devServers.start")).toBe(true),
  );
  vi.mocked(f.context.authorized).mockResolvedValue(false);
  gate.resolve();
  await blocking;
  await expect(queued).rejects.toThrow("revoked");
  expect(f.spawnProcess).not.toHaveBeenCalled();
});

it("retains process birth and reviewed impact checks, and reauthorizes immediately before signalling", async () => {
  const f = fixture(),
    target = await f.target();
  const details = dto.DevServersDetailsResultSchema.parse(
    await f.service.details(target, f.context),
  );
  await expect(
    f.service.stop({ ...target, expectedImpact: "stale-review" }, f.context),
  ).rejects.toThrow("reviewed");
  expect(f.discovery.signal).not.toHaveBeenCalled();
  f.discovery.identity.mockImplementationOnce(async (pid) => {
    vi.mocked(f.context.authorized).mockResolvedValue(false);
    return f.discovery.live.get(pid);
  });
  await expect(
    f.service.stop({ ...target, expectedImpact: details.expectedImpact }, f.context),
  ).rejects.toThrow("revoked");
  expect(f.discovery.signal).not.toHaveBeenCalled();
  vi.mocked(f.context.authorized).mockResolvedValue(true);
  const stopped = dto.DevServersStopResultSchema.parse(
    await f.service.kill({ ...target, expectedImpact: details.expectedImpact }, f.context),
  );
  expect(stopped).toMatchObject({ state: "stopped", requiresForce: false, affectedPorts: [3101] });
  expect(f.discovery.signal.mock.calls[0]).toEqual([
    expect.objectContaining({ pid: 101, startedAt: "birth.101" }),
    true,
  ]);
});

it("preserves external restart requirements, dedicated child flags, logs and stopped activity release", async () => {
  const f = fixture(),
    target = await f.target();
  await expect(f.service.restart(target, f.context)).rejects.toThrow("explicit command");
  expect(f.discovery.signal).not.toHaveBeenCalled();
  const started = dto.DevServersStartResultSchema.parse(
    await f.service.restart({ ...target, command: "pnpm dev", cwd: f.project }, f.context),
  );
  expect(started.server?.managed).toBe(true);
  expect(f.spawnProcess.mock.calls[0][2].stdio).toEqual(["ignore", "pipe", "pipe"]);
  f.children[0].stdout!.emit("data", Buffer.from("ready\n"));
  expect(
    dto.DevServersLogsResultSchema.parse(
      await f.service.logs({ projectId: "project", id: started.server!.id }, f.context),
    ),
  ).toMatchObject({ available: true, output: "ready\n" });
  await f.service.stop({ projectId: "project", id: started.server!.id }, f.context);
  expect(f.release).toHaveBeenCalledTimes(1);
});

it("selects only the current discovered endpoint and rechecks the existing browser effect port", async () => {
  const f = fixture(),
    target = await f.target();
  await expect(f.service.openExternal({ ...target, port: 9999 }, f.context)).rejects.toThrow(
    "no longer listening",
  );
  expect(f.ports.openExternal).not.toHaveBeenCalled();
  expect(
    await f.service.openExternal({ ...target, port: 3101, address: "127.0.0.1" }, f.context),
  ).toEqual({ url: "http://127.0.0.1:3101" });
  expect(f.ports.openExternal.mock.calls[0][0]).toBe("http://127.0.0.1:3101");
  f.ports.openExternal.mockImplementationOnce(async (_url, _context, authorize) => {
    vi.mocked(f.context.authorized).mockResolvedValue(false);
    await authorize();
    return { url: "unreachable" };
  });
  await expect(f.service.openExternal({ ...target, port: 3101 }, f.context)).rejects.toThrow(
    "revoked",
  );
});

class Socket extends EventEmitter {
  setNoDelay = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
  destroy = vi.fn(() => {
    this.emit("close");
    return this;
  });
  write = vi.fn((_data: Buffer, callback: (error?: Error) => void) => {
    queueMicrotask(() => callback());
    return true;
  });
}
async function bridgeFixture() {
  const f = fixture(),
    socket = new Socket();
  net.connect.mockImplementation(() => {
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  const access = new DevServerAccess(
    async (params) =>
      dto.DevServersDetailsResultSchema.parse(
        await f.owner.handle("devServers.details", params, [
          { id: "project", name: "Project", path: f.project },
        ]),
      ),
    () => 3776,
  );
  cleanups.push(() => access.close());
  const cap =
    (owner: string) =>
    (method: string, params: Record<string, unknown>, authorize: () => Promise<void>) =>
      access.handle(method, params, owner, authorize);
  f.context.devServerAccess = cap("paired.a");
  const params = { ...(await f.target()), port: 3101, address: "127.0.0.1" };
  return { ...f, socket, access, cap, params };
}

it("keeps private stream grants request scoped to the existing credential owner and project", async () => {
  const f = await bridgeFixture();
  expect(
    dto.DevServersBridgeCheckResultSchema.parse(await f.service.bridgeCheck(f.params, f.context))
      .connectAddress,
  ).toBe("127.0.0.1");
  const opened = dto.DevServersBridgeOpenResultSchema.parse(
    await f.service.bridgeOpen(f.params, f.context),
  );
  expect(net.connect).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3101 });
  const other: DevServersContext = { ...f.context, devServerAccess: f.cap("paired.b") };
  await expect(
    f.service.bridgeClose({ projectId: "project", streamId: opened.streamId }, other),
  ).rejects.toThrow("another device");
  const data = Buffer.from("GET /nested?x=1 HTTP/1.1\r\n\r\n");
  expect(
    await f.service.bridgeWrite(
      { projectId: "project", streamId: opened.streamId, data: data.toString("base64") },
      f.context,
    ),
  ).toEqual({ written: data.length });
  expect(f.socket.write.mock.calls[0][0]).toEqual(data);
  f.socket.emit("data", Buffer.from("preserved"));
  expect(
    dto.DevServersBridgeReadResultSchema.parse(
      await f.service.bridgeRead({ projectId: "project", streamId: opened.streamId }, f.context),
    ).data,
  ).toBe(Buffer.from("preserved").toString("base64"));
  expect(
    await f.service.bridgeClose({ projectId: "project", streamId: opened.streamId }, f.context),
  ).toEqual({ closed: true });
  expect(f.socket.destroy).toHaveBeenCalledTimes(1);
});

it("suppresses a revoked private read after its actual wait without consuming the pending bytes", async () => {
  const f = await bridgeFixture();
  const { streamId } = dto.DevServersBridgeOpenResultSchema.parse(
    await f.service.bridgeOpen(f.params, f.context),
  );
  const pending = f.service.bridgeRead({ projectId: "project", streamId }, f.context);
  // Every fake owner dependency resolves in microtasks. A full event-loop turn
  // reaches the real long-poll wait, without reading private relay state.
  await new Promise<void>((done) => setImmediate(done));
  vi.mocked(f.context.authorized).mockResolvedValue(false);
  f.socket.emit("data", Buffer.from("not disclosed"));
  await expect(pending).rejects.toThrow("revoked");
  vi.mocked(f.context.authorized).mockResolvedValue(true);
  expect(
    dto.DevServersBridgeReadResultSchema.parse(
      await f.service.bridgeRead({ projectId: "project", streamId }, f.context),
    ).data,
  ).toBe(Buffer.from("not disclosed").toString("base64"));
});

it("rechecks a private endpoint lookup before connect and destroys a newly connected revoked lease", async () => {
  const f = await bridgeFixture();
  const listeners = f.discovery.listeners.getMockImplementation()!;
  f.discovery.listeners.mockImplementationOnce(async () => {
    vi.mocked(f.context.authorized).mockResolvedValue(false);
    return listeners();
  });
  await expect(f.service.bridgeOpen(f.params, f.context)).rejects.toThrow("revoked");
  expect(net.connect).not.toHaveBeenCalled();
  vi.mocked(f.context.authorized).mockResolvedValue(true);
  net.connect.mockImplementationOnce(() => f.socket);
  const pending = f.service.bridgeOpen(f.params, f.context);
  await vi.waitFor(() => expect(net.connect).toHaveBeenCalledTimes(1));
  vi.mocked(f.context.authorized).mockResolvedValue(false);
  f.socket.emit("connect");
  await expect(pending).rejects.toThrow("revoked");
  expect(f.socket.destroy).toHaveBeenCalledTimes(1);
});

it("does not spawn a replacement after a completed restart stop loses its request grant", async () => {
  const f = fixture(),
    target = await f.target();
  f.discovery.signal.mockImplementationOnce(async (identity) => {
    f.discovery.live.delete(identity.pid);
    f.discovery.ports.delete(identity.pid);
    vi.mocked(f.context.authorized).mockResolvedValue(false);
  });
  await expect(
    f.service.restart({ ...target, command: "pnpm dev", cwd: f.project }, f.context),
  ).rejects.toThrow("revoked");
  expect(f.discovery.signal).toHaveBeenCalledTimes(1);
  expect(f.spawnProcess).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
});

it("rejects missing request capabilities and stale endpoint identities before private connection I/O", async () => {
  const f = await bridgeFixture();
  await expect(f.service.bridgeOpen(f.params, { authorized: async () => true })).rejects.toThrow(
    "unavailable",
  );
  await expect(
    f.service.bridgeOpen({ ...f.params, identity: { pid: 101, startedAt: "reused" } }, f.context),
  ).rejects.toThrow("identity must match");
  expect(net.connect).not.toHaveBeenCalled();
});

it("waits for an actual private write settlement before reporting revoked delivery, without replay", async () => {
  const f = await bridgeFixture();
  const { streamId } = dto.DevServersBridgeOpenResultSchema.parse(
    await f.service.bridgeOpen(f.params, f.context),
  );
  let finish!: () => void;
  f.socket.write.mockImplementationOnce((_data, callback) => {
    finish = () => callback();
    return true;
  });
  const result = f.service.bridgeWrite(
    { projectId: "project", streamId, data: Buffer.from("one delivery").toString("base64") },
    f.context,
  );
  await vi.waitFor(() => expect(f.socket.write).toHaveBeenCalledTimes(1));
  vi.mocked(f.context.authorized).mockResolvedValue(false);
  finish();
  await expect(result).rejects.toThrow("revoked");
  expect(f.socket.write).toHaveBeenCalledTimes(1);
});
