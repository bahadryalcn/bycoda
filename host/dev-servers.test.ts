import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DevProcess,
  DevProcessIdentity,
  DevServer,
  DevServerEndpoint,
  DevServerScan,
  DevServerStartResult,
} from "../src/features/host-tools/devServerTypes";
import { DevServerDiscovery } from "./dev-server-discovery";
import {
  DevServersService,
  devServerDescendants,
  devServerProject,
  type DevServerProcessDiscovery,
  type DevServersOptions,
} from "./dev-servers";
import { RuntimeLogsService } from "./runtime-logs";

const root: DevProcess = {
  pid: 101,
  startedAt: "birth-101",
  parentPid: 90,
  name: "node",
  cwd: process.cwd(),
  command: "node server.js",
};
const endpoint = (port: number): DevServerEndpoint => ({
  address: "127.0.0.1",
  port,
  url: `http://127.0.0.1:${port}`,
});
const projects = [{ id: "project", name: "Project", path: process.cwd() }];

class Discovery implements DevServerProcessDiscovery {
  live = new Map<number, DevProcess>([[root.pid, { ...root }]]);
  ports = new Map<number, DevServerEndpoint[]>([[root.pid, [endpoint(3101), endpoint(3102)]]]);
  stubborn = false;
  listeners = vi.fn(async () =>
    [...this.live.values()]
      .filter((process) => this.ports.has(process.pid))
      .map((process) => ({ process: { ...process }, endpoints: this.ports.get(process.pid)! })),
  );
  processes = vi.fn(async () => [...this.live.values()].map((process) => ({ ...process })));
  identity = vi.fn(async (pid: number) => this.live.get(pid));
  signal = vi.fn(async (identity: DevProcessIdentity, force: boolean) => {
    const live = this.live.get(identity.pid);
    if (live && live.startedAt !== identity.startedAt) throw new Error("PID reused");
    if (force || !this.stubborn) this.live.delete(identity.pid);
  });
}

function fixture(options: Partial<DevServersOptions> = {}) {
  const discovery = new Discovery();
  const children: ChildProcess[] = [];
  const spawnProcess = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: root.pid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
    children.push(child);
    return child;
  });
  const service = new DevServersService({
    discovery,
    spawnProcess: spawnProcess as unknown as typeof spawn,
    shellProfile: null,
    graceMs: 0,
    cacheMs: 1000,
    ...options,
  });
  const list = async () => (await service.handle("devServers.list", {}, projects)) as DevServerScan;
  const selected = async () => (await list()).servers[0];
  const target = (server: DevServer, tree = false) => ({
    id: server.id,
    identity: server.process,
    tree,
  });
  return { discovery, children, spawnProcess, service, list, selected, target };
}

it("passes workspace port identities to its owned command, retains leases until verified stop, and reacquires on restart", async () => {
  const { service, discovery, spawnProcess } = fixture();
  let nextPid = 201;
  spawnProcess.mockImplementation((...arguments_: unknown[]) => {
    const options = arguments_[2] as { env: NodeJS.ProcessEnv };
    const pid = nextPid++;
    discovery.live.set(pid, { ...root, pid, startedAt: `lease-${pid}` });
    discovery.ports.set(pid, [endpoint(Number(options.env.BYCODA_VITE_PORT))]);
    return Object.assign(new EventEmitter(), {
      pid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
  });
  const first = await service.startWorkspace(
    {
      workspaceId: "workspace",
      runId: "one",
      kinds: ["vite", "hmr", "host", "cdp"],
      command: "pnpm dev",
      cwd: process.cwd(),
    },
    projects,
  );
  expect(first.result.server).toMatchObject({ state: "running", process: { pid: 201 } });
  const invocation = (spawnProcess.mock.calls as unknown as unknown[][])[0];
  expect(invocation[2]).toMatchObject({
    env: {
      BYCODA_VITE_PORT: String(first.lease.ports.vite),
      BYCODA_HMR_PORT: String(first.lease.ports.hmr),
      BYCODA_DEV_HOST_PORT: String(first.lease.ports.host),
      BYCODA_WEBVIEW_DEBUG_PORT: String(first.lease.ports.cdp),
    },
  });
  expect(await service.portLeases.list("workspace")).toHaveLength(1);
  const restarted = (await service.handle(
    "devServers.restart",
    { id: first.result.server!.id },
    projects,
  )) as DevServerStartResult;
  expect(restarted.server).toMatchObject({ state: "running", process: { pid: 202 } });
  const active = await service.portLeases.list("workspace");
  expect(active).toHaveLength(1);
  expect(active[0].id).not.toBe(first.lease.id);
  await service.handle("devServers.stop", { id: restarted.server!.id }, projects);
  expect(await service.portLeases.list("workspace")).toEqual([]);
  expect(discovery.live.has(root.pid)).toBe(true);
});

it("rejects a changed reviewed process tree or port set before signalling", async () => {
  const test = fixture();
  const server = await test.selected();
  const target = test.target(server, true);
  const review = (await test.service.handle("devServers.details", target, projects)) as {
    expectedImpact: string;
  };
  test.discovery.ports.set(root.pid, [endpoint(3999)]);
  await expect(
    test.service.handle(
      "devServers.kill",
      { ...target, expectedImpact: review.expectedImpact },
      projects,
    ),
  ).rejects.toThrow("reviewed process tree or ports changed");
  expect(test.discovery.signal).not.toHaveBeenCalled();
  const fresh = (await test.service.handle("devServers.details", target, projects)) as {
    expectedImpact: string;
  };
  await test.service.handle(
    "devServers.kill",
    { ...target, expectedImpact: fresh.expectedImpact },
    projects,
  );
  expect(test.discovery.signal).toHaveBeenCalledOnce();
});

it("rejects an unreviewed child process before force signalling", async () => {
  const test = fixture();
  const server = await test.selected();
  const target = test.target(server, true);
  const review = (await test.service.handle("devServers.details", target, projects)) as {
    expectedImpact: string;
  };
  test.discovery.live.set(202, {
    pid: 202,
    parentPid: root.pid,
    startedAt: "new-child",
    name: "worker",
  });
  await expect(
    test.service.handle(
      "devServers.kill",
      { ...target, expectedImpact: review.expectedImpact },
      projects,
    ),
  ).rejects.toThrow("reviewed process tree or ports changed");
  expect(test.discovery.signal).not.toHaveBeenCalled();
});

describe("host dev server management", () => {
  it("associates dot-prefixed children without accepting parent or sibling paths", () => {
    for (const [base, child, sibling] of [
      ["C:\\work\\app", "C:\\work\\app\\..preview", "C:\\work\\app-other"],
      ["/work/app", "/work/app/..preview", "/work/app-other"],
    ]) {
      const project = { id: "p", path: base };
      expect(devServerProject(child, [project])).toBe(project);
      expect(devServerProject(sibling, [project])).toBeUndefined();
      expect(devServerProject(`${base}/..`, [project])).toBeUndefined();
    }
  });
  it("groups ports by process birth, associates only cwd, and marks uncertain projects", async () => {
    const { discovery, list } = fixture();
    discovery.live.set(102, {
      pid: 102,
      startedAt: "birth-102",
      name: "node",
      command: `node ${process.cwd()}/other.js`,
    });
    discovery.ports.set(102, [endpoint(3200)]);
    const scan = await list();
    expect(scan.status).toBe("ok");
    expect(scan.servers).toHaveLength(2);
    expect(scan.servers[0]).toMatchObject({
      association: "cwd",
      projectId: "project",
      logsAvailable: false,
      managed: false,
    });
    expect(scan.servers[0].endpoints.map((entry) => entry.port)).toEqual([3101, 3102]);
    expect(scan.servers[1]).toMatchObject({ association: "uncertain" });
    expect(scan.servers[1].projectId).toBeUndefined();
    expect(
      devServerProject("C:\\work\\application", [
        { id: "wrong", name: "Wrong", path: "C:\\work\\app" },
      ]),
    ).toBeUndefined();
    expect(
      devServerProject("C:\\WORK\\app\\nested", [
        { id: "right", name: "Right", path: "c:\\work\\app" },
      ])?.id,
    ).toBe("right");
  });

  it("distinguishes an empty scan from a failed scan and bounds/cache-coalesces discovery", async () => {
    const { discovery, service } = fixture();
    discovery.live.clear();
    const [first, second] = await Promise.all([service.list(projects), service.list(projects)]);
    expect(first).toMatchObject({ status: "ok", servers: [] });
    expect(second).toEqual(first);
    await service.list(projects);
    expect(discovery.listeners).toHaveBeenCalledTimes(1);
    discovery.listeners.mockRejectedValueOnce(new Error("Access denied"));
    expect(await service.list(projects, true)).toMatchObject({
      status: "error",
      error: "Access denied",
      servers: [],
    });
    const hanging = new DevServersService({
      discovery: {
        ...discovery,
        listeners: () => new Promise(() => {}),
        processes: discovery.processes,
        identity: discovery.identity,
        signal: discovery.signal,
      },
      scanTimeoutMs: 5,
    });
    expect(await hanging.list(projects)).toMatchObject({
      status: "error",
      error: "Dev server discovery timed out.",
    });
  });

  it("requires the observed external identity and refuses a reused PID", async () => {
    const { discovery, selected, target, service } = fixture();
    const server = await selected();
    await expect(service.handle("devServers.stop", { id: server.id }, projects)).rejects.toThrow(
      "identity",
    );
    discovery.live.set(root.pid, { ...root, startedAt: "new-owner" });
    await expect(service.handle("devServers.kill", target(server), projects)).rejects.toThrow(
      "different process",
    );
    expect(discovery.signal).not.toHaveBeenCalled();
  });

  it("times out queued operations and releases the slot without corrupting concurrency", async () => {
    const discovery = new Discovery();
    let finish!: (value: { process: DevProcess; endpoints: DevServerEndpoint[] }[]) => void;
    discovery.listeners.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const service = new DevServersService({ discovery, maxConcurrent: 1, queueTimeoutMs: 5 });
    const first = service.handle("devServers.list", {}, projects);
    await expect(service.handle("devServers.logs", { id: "none" }, projects)).rejects.toThrow(
      "operation slot",
    );
    finish([]);
    await first;
    expect(await service.handle("devServers.logs", { id: "none" }, projects)).toEqual({
      available: false,
      output: "",
    });
  });

  it("revalidates each identity immediately before signalling it", async () => {
    const { discovery, selected, target, service } = fixture();
    const server = await selected();
    discovery.identity.mockResolvedValueOnce({ ...root, startedAt: "reused-after-snapshot" });
    await expect(service.handle("devServers.kill", target(server), projects)).rejects.toThrow(
      "not signalled",
    );
    expect(discovery.signal).not.toHaveBeenCalled();
  });

  it("tries graceful shutdown first, keeps surviving processes, and forces only on an explicit request", async () => {
    const { discovery, selected, target, service } = fixture();
    discovery.stubborn = true;
    const server = await selected();
    expect(await service.handle("devServers.stop", target(server), projects)).toMatchObject({
      state: "running",
      requiresForce: true,
      affectedPorts: [3101, 3102],
    });
    expect(discovery.signal.mock.calls.map((call) => call[1])).toEqual([false]);
    expect(await service.handle("devServers.kill", target(server), projects)).toMatchObject({
      state: "stopped",
      requiresForce: false,
    });
    expect(discovery.signal.mock.calls.map((call) => call[1])).toEqual([false, true]);
    expect(await service.list(projects)).toMatchObject({ status: "ok", servers: [] });
  });

  it("shows descendant ports and stops only the selected tree without closing its shared terminal or siblings", async () => {
    const { discovery, selected, target, service } = fixture();
    discovery.live.set(90, { pid: 90, startedAt: "terminal", name: "pwsh" });
    discovery.live.set(102, { pid: 102, startedAt: "child", parentPid: root.pid, name: "node" });
    discovery.live.set(103, { pid: 103, startedAt: "grandchild", parentPid: 102, name: "node" });
    discovery.live.set(104, { pid: 104, startedAt: "sibling", parentPid: 90, name: "node" });
    discovery.ports.set(102, [endpoint(3201)]);
    discovery.ports.set(103, [endpoint(3202)]);
    discovery.ports.set(104, [endpoint(3300)]);
    const server = await selected();
    expect(
      await service.handle("devServers.details", target(server, true), projects),
    ).toMatchObject({ affectedPorts: [3101, 3102, 3201, 3202] });
    expect(await service.handle("devServers.kill", target(server, true), projects)).toMatchObject({
      affectedPorts: [3101, 3102, 3201, 3202],
      state: "stopped",
    });
    expect(discovery.signal.mock.calls.map((call) => call[0].pid)).toEqual([103, 102, 101]);
    expect([...discovery.live.keys()]).toEqual([90, 104]);
  });

  it("keeps descendants when the external user selects a single process", async () => {
    const { discovery, selected, target, service } = fixture();
    discovery.live.set(102, { pid: 102, startedAt: "child", parentPid: root.pid, name: "node" });
    discovery.ports.set(102, [endpoint(3201)]);
    const server = await selected();
    await service.handle("devServers.kill", target(server), projects);
    expect([...discovery.live.keys()]).toEqual([102]);
  });

  it("excludes stale Windows parent PIDs referring to a younger reused parent", () => {
    const parent = { ...root, startedAt: "2000000000000000" };
    const older = {
      pid: 102,
      parentPid: parent.pid,
      startedAt: "1000000000000000",
      name: "unrelated-old-child",
    };
    const younger = {
      pid: 103,
      parentPid: parent.pid,
      startedAt: "3000000000000000",
      name: "actual-child",
    };
    expect(devServerDescendants(parent, [older, younger])).toEqual([younger]);
  });

  it("returns fresh listening endpoints from details instead of old observed URLs", async () => {
    const { discovery, selected, target, service } = fixture();
    const server = await selected();
    discovery.ports.delete(root.pid);
    expect(await service.handle("devServers.details", target(server), projects)).toMatchObject({
      server: { endpoints: [] },
      affectedPorts: [],
    });
  });

  it("protects the host and its terminal ancestors", async () => {
    const { discovery, service } = fixture();
    const host = { ...root, pid: process.pid, startedAt: "host" };
    discovery.live.set(process.pid, host);
    discovery.ports.set(process.pid, [endpoint(3400)]);
    const server = (await service.list(projects)).servers.find(
      (entry) => entry.process?.pid === process.pid,
    )!;
    await expect(
      service.handle("devServers.kill", { id: server.id, identity: host }, projects),
    ).rejects.toThrow("host process");
    expect(discovery.signal).not.toHaveBeenCalled();
  });

  it("refuses an unverified tree member before signalling any of its siblings", async () => {
    const { discovery, selected, target, service } = fixture();
    discovery.live.set(102, {
      pid: 102,
      parentPid: root.pid,
      startedAt: "",
      name: "unverified-child",
    });
    discovery.live.set(103, {
      pid: 103,
      parentPid: root.pid,
      startedAt: "verified-child",
      name: "node",
    });
    const server = await selected();
    await expect(service.handle("devServers.kill", target(server, true), projects)).rejects.toThrow(
      "no process was signalled",
    );
    expect(discovery.signal).not.toHaveBeenCalled();
  });

  it("never guesses an external restart command or working directory", async () => {
    const { discovery, selected, target, service, spawnProcess } = fixture();
    const server = await selected();
    await expect(service.handle("devServers.restart", target(server), projects)).rejects.toThrow(
      "explicit command and working directory",
    );
    await expect(
      service.handle("devServers.restart", { ...target(server), command: "npm run dev" }, projects),
    ).rejects.toThrow("explicit command and working directory");
    expect(discovery.signal).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(await service.handle("devServers.logs", target(server), projects)).toEqual({
      available: false,
      output: "",
    });
  });

  it("validates an external replacement directory before stopping its process", async () => {
    const { discovery, selected, target, service, spawnProcess } = fixture();
    const server = await selected();
    await expect(
      service.handle(
        "devServers.restart",
        {
          ...target(server),
          command: "npm run dev",
          cwd: `${process.cwd()}/missing-dev-server-test-directory`,
        },
        projects,
      ),
    ).rejects.toThrow("does not exist");
    expect(discovery.signal).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("shows the current process on expected-port collisions and rejects invalid ports before spawning", async () => {
    const { service, spawnProcess } = fixture();
    for (const expectedPort of [0, 65536, 1.5, "3000", null]) {
      await expect(
        service.handle(
          "devServers.start",
          { command: "npm run dev", projectId: "project", expectedPort },
          projects,
        ),
      ).rejects.toThrow("Expected port");
    }
    expect(
      await service.handle(
        "devServers.start",
        { command: "npm run dev", projectId: "project", expectedPort: 3101 },
        projects,
      ),
    ).toMatchObject({ conflict: { port: 3101, servers: [{ process: { pid: 101 } }] } });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("surfaces a port conflict that appears between preflight discovery and spawning", async () => {
    const { service, discovery, spawnProcess } = fixture();
    discovery.listeners.mockResolvedValueOnce([]);
    spawnProcess.mockImplementation(() => {
      discovery.live.set(105, { ...root, pid: 105, startedAt: "new-managed" });
      return Object.assign(new EventEmitter(), {
        pid: 105,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }) as unknown as ChildProcess;
    });
    expect(
      await service.handle(
        "devServers.start",
        { command: "npm run dev", projectId: "project", expectedPort: 3101 },
        projects,
      ),
    ).toMatchObject({ conflict: { port: 3101, servers: [{ process: { pid: 101 } }] } });
  });

  it("owns a hidden dedicated command, bounded logs, lifecycle, and a safe managed restart", async () => {
    const { service, discovery, children, spawnProcess } = fixture();
    const started = (await service.handle(
      "devServers.start",
      { command: "npm run dev", name: "Dev", projectId: "project" },
      projects,
    )) as DevServerStartResult;
    expect(started.server).toMatchObject({
      state: "running",
      managed: true,
      logsAvailable: true,
      projectId: "project",
    });
    expect(spawnProcess.mock.calls[0]).toBeDefined();
    const options = (spawnProcess.mock.calls as unknown as unknown[][])[0][2];
    expect(options).toMatchObject({
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children[0].stdout!.emit("data", Buffer.from("x".repeat(300_000)));
    children[0].stderr!.emit("data", Buffer.from("tail-error"));
    const logs = (await service.handle(
      "devServers.logs",
      { id: started.server!.id },
      projects,
    )) as { available: boolean; output: string };
    expect(logs.available).toBe(true);
    expect(logs.output.length).toBe(256 * 1024);
    expect(logs.output.endsWith("tail-error")).toBe(true);
    expect((await service.list(projects, true)).servers).toMatchObject([
      { managed: true, state: "running", endpoints: [endpoint(3101), endpoint(3102)] },
    ]);
    discovery.stubborn = true;
    await expect(
      service.handle("devServers.restart", { id: started.server!.id }, projects),
    ).rejects.toThrow("still running");
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    await service.handle("devServers.kill", { id: started.server!.id }, projects);
    await service.handle("devServers.restart", { id: started.server!.id }, projects);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it("uses an explicit managed restart command while retaining the original project directory", async () => {
    const { service, discovery, spawnProcess } = fixture();
    const started = (await service.handle(
      "devServers.start",
      { command: "pnpm dev --old-option", projectId: "project" },
      projects,
    )) as DevServerStartResult;
    spawnProcess.mockImplementation(() => {
      discovery.live.set(105, { ...root, pid: 105, startedAt: "replacement" });
      return Object.assign(new EventEmitter(), {
        pid: 105,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }) as unknown as ChildProcess;
    });
    const restarted = (await service.handle(
      "devServers.restart",
      { id: started.server!.id, command: "  pnpm dev --new-option  ", cwd: "/other-project" },
      projects,
    )) as DevServerStartResult;
    expect(restarted.server).toMatchObject({
      command: "pnpm dev --new-option",
      cwd: process.cwd(),
      projectId: "project",
    });
    const invocation = (spawnProcess.mock.calls as unknown as unknown[][])[1];
    expect(invocation[1]).toContain("pnpm dev --new-option");
    expect(invocation[2]).toMatchObject({ cwd: process.cwd(), windowsHide: true });
  });

  it.each(["", "   ", null, 42])(
    "rejects an invalid explicit restart command %j before stopping the running server",
    async (command) => {
      const { service, discovery, spawnProcess } = fixture();
      const started = (await service.handle(
        "devServers.start",
        { command: "pnpm dev", projectId: "project" },
        projects,
      )) as DevServerStartResult;
      await expect(
        service.handle("devServers.restart", { id: started.server!.id, command }, projects),
      ).rejects.toThrow("A dev server command is required.");
      expect(discovery.signal).not.toHaveBeenCalled();
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    },
  );

  it("restarts an exited managed server after PID reuse without touching the new owner", async () => {
    const { service, discovery, children, spawnProcess } = fixture();
    const started = (await service.handle(
      "devServers.start",
      { command: "npm run dev", projectId: "project" },
      projects,
    )) as DevServerStartResult;
    children[0].emit("close", 0);
    discovery.live.set(root.pid, { ...root, startedAt: "unrelated-new-owner" });
    spawnProcess.mockImplementation(() => {
      discovery.live.set(105, { ...root, pid: 105, startedAt: "new-managed" });
      return Object.assign(new EventEmitter(), {
        pid: 105,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }) as unknown as ChildProcess;
    });
    expect(
      await service.handle("devServers.restart", { id: started.server!.id }, projects),
    ).toMatchObject({ server: { process: { pid: 105 }, managed: true } });
    expect(discovery.signal).not.toHaveBeenCalled();
    expect(discovery.live.get(root.pid)?.startedAt).toBe("unrelated-new-owner");
  });

  it("keeps managed descendants and their ports when the dedicated shell exits", async () => {
    const { service, discovery, children } = fixture();
    const started = (await service.handle(
      "devServers.start",
      { command: "npm run dev", projectId: "project" },
      projects,
    )) as DevServerStartResult;
    discovery.live.set(102, { pid: 102, startedAt: "child", parentPid: root.pid, name: "node" });
    discovery.ports.set(102, [endpoint(3201)]);
    await service.list(projects, true);
    discovery.live.delete(root.pid);
    children[0].emit("close", 0);
    expect((await service.list(projects, true)).servers).toMatchObject([
      { managed: true, state: "running", endpoints: [endpoint(3201)] },
    ]);
    expect(
      await service.handle("devServers.kill", { id: started.server!.id }, projects),
    ).toMatchObject({ state: "stopped", affectedPorts: [3201] });
    expect(discovery.signal).toHaveBeenCalledWith(expect.objectContaining({ pid: 102 }), true);
  });
});

it("uses only an explicit bind-error port to report a conflict without configured expectedPort", async () => {
  const { service, discovery, spawnProcess } = fixture();
  spawnProcess.mockImplementation(() => {
    discovery.live.set(105, { ...root, pid: 105, startedAt: "new-managed" });
    const child = Object.assign(new EventEmitter(), {
      pid: 105,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
    setTimeout(
      () =>
        child.stderr!.emit(
          "data",
          Buffer.from("Error: listen EADDRINUSE: address already in use 127.0.0.1:3101\n"),
        ),
      0,
    );
    return child;
  });
  expect(
    await service.handle(
      "devServers.start",
      { command: "npm run dev", projectId: "project" },
      projects,
    ),
  ).toMatchObject({
    server: { state: "error" },
    conflict: { port: 3101, servers: [{ process: { pid: 101 } }] },
  });
});

const realChildren: ChildProcess[] = [];
const realManaged: { service: DevServersService; id: string }[] = [];
afterEach(async () => {
  for (const { service, id } of realManaged.splice(0)) {
    await service.handle("devServers.kill", { id, tree: true }, projects);
  }
  // These handles are exclusively children created by this suite; never touch discovered user processes.
  for (const child of realChildren.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  }
});

it("discovers and manages only a real test-owned server listening on two random ports", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');let n=0;for(let i=0;i<2;i++){const s=http.createServer((q,r)=>r.end('test-owned'));s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);if(++n===2)console.log('READY')})}process.on('SIGTERM',()=>process.exit(0));`,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  realChildren.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("READY")) resolve();
    });
  });

  const discovery = new DevServerDiscovery();
  const service = new DevServersService({ discovery, graceMs: 100, pollMs: 20 });
  // A cold Windows CIM provider can exceed one bounded discovery attempt.
  // Wait for a real successful snapshot, without treating an error as empty
  // discovery or changing the production command timeout.
  const scan = await vi.waitFor(
    async () => {
      const result = await service.list([]);
      expect(result.status, result.error).toBe("ok");
      return result;
    },
    { timeout: 30_000, interval: 200 },
  );
  const server = scan.servers.find((entry) => entry.process?.pid === child.pid)!;
  expect(server).toBeDefined();
  expect(server.endpoints).toHaveLength(2);
  expect(server.process?.startedAt).toBeTruthy();
  const target = { id: server.id, identity: server.process };
  const stopped = (await service.handle("devServers.stop", target, [])) as {
    requiresForce: boolean;
  };
  if (stopped.requiresForce)
    expect(await service.handle("devServers.kill", target, [])).toMatchObject({
      state: "stopped",
      requiresForce: false,
    });
  expect(await discovery.identity(child.pid!)).toBeUndefined();
}, 60_000);

describe("unified managed-server log capture", () => {
  it("masks multiline PEM independently per process stream before log retention and output", async () => {
    const runtimeLogs = new RuntimeLogsService();
    const { service, children } = fixture({ runtimeLogs });
    await service.handle(
      "devServers.start",
      { projectId: "project", command: "node server.js", name: "Web" },
      projects,
    );
    const child = children[0];
    for (const text of [
      "-----BEGIN PRI",
      "VATE KEY-----\n",
      "SYNTHETIC_PEM_A\n",
      "SYNTHETIC_PEM_B\n",
      "-----END PRIVATE KEY-----\n",
      "healthy\n",
    ]) {
      child.stdout!.emit("data", Buffer.from(text));
    }
    child.stderr!.emit(
      "data",
      Buffer.from("stderr diagnostic\n-----BEGIN PRIVATE KEY-----\nSYNTHETIC_UNCLOSED"),
    );
    child.emit("close", 0);
    const snapshot = runtimeLogs.read();
    expect(JSON.stringify(snapshot)).not.toContain("SYNTHETIC");
    expect(snapshot.entries.map((entry) => entry.message)).toContain("healthy");
    expect(snapshot.entries.map((entry) => entry.message)).toContain("stderr diagnostic");
    const legacy = (await service.handle(
      "devServers.logs",
      { id: (await service.list(projects)).servers[0].id },
      projects,
    )) as { output: string };
    expect(legacy.output).not.toContain("SYNTHETIC");
  });
  it("decodes split UTF-8, keeps streams line-safe, redacts secrets and infers stderr severity conservatively", async () => {
    const runtimeLogs = new RuntimeLogsService();
    const { service, children } = fixture({ runtimeLogs });
    const started = (await service.handle(
      "devServers.start",
      { projectId: "project", command: "node server.js", name: "Web" },
      projects,
    )) as DevServerStartResult;
    const child = children[0];
    const bytes = Buffer.from("Türkçe\r\n");
    child.stdout!.emit("data", bytes.subarray(0, 2));
    expect(runtimeLogs.read().entries).toEqual([]);
    child.stdout!.emit("data", bytes.subarray(2));
    child.stdout!.emit("data", Buffer.from("token=split-"));
    child.stdout!.emit("data", Buffer.from("secret\npartial final"));
    child.stderr!.emit(
      "data",
      Buffer.from(
        "compiled successfully\nwarning: deprecated API\nError: request failed\n    at render (/app/view.ts:12:7)\n",
      ),
    );
    child.emit("close", 0);
    child.stdout!.emit("data", Buffer.from("late output\n"));
    child.emit("error", new Error("late process event"));
    const snapshot = runtimeLogs.read({ projectId: "project", sessionId: "session" });
    expect(snapshot.entries.map((entry) => entry.message)).toEqual([
      "Türkçe",
      "token=[REDACTED]",
      "compiled successfully",
      "warning: deprecated API",
      "Error: request failed",
      "    at render (/app/view.ts:12:7)",
      "partial final",
    ]);
    expect(snapshot.entries.map((entry) => entry.level)).toEqual([
      "info",
      "info",
      "info",
      "warn",
      "error",
      "info",
      "info",
    ]);
    expect(snapshot.entries[5]).toMatchObject({
      stack: "    at render (/app/view.ts:12:7)",
      location: { file: "/app/view.ts", line: 12, column: 7 },
    });
    expect(
      snapshot.sources.find((item) => item.id === `server:${started.server!.id}`)?.available,
    ).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("split-secret");
    const legacy = (await service.handle(
      "devServers.logs",
      { id: started.server!.id },
      projects,
    )) as { available: boolean; output: string };
    expect(legacy.available).toBe(true);
    expect(legacy.output).not.toContain("split-");
    expect(legacy.output).not.toContain("secret");
  });

  it("bounds unfinished lines and marks external sources unavailable without inventing entries", async () => {
    const runtimeLogs = new RuntimeLogsService();
    const { service, children, discovery } = fixture({ runtimeLogs });
    await Promise.all([service.refreshLogSources(projects), service.refreshLogSources(projects)]);
    await service.refreshLogSources(projects);
    expect(discovery.listeners).toHaveBeenCalledTimes(1);
    expect(runtimeLogs.read({ projectId: "project" })).toMatchObject({
      entries: [],
      sources: [
        { kind: "server", available: false, reason: expect.stringContaining("outside bycoda") },
      ],
    });
    await service.handle(
      "devServers.start",
      { projectId: "project", command: "node server.js" },
      projects,
    );
    const child = children[0];
    child.stdout!.emit("data", Buffer.from("x".repeat(300_000)));
    expect(runtimeLogs.read().entries).toEqual([]);
    child.stdout!.emit("data", Buffer.from("discarded\nnext\n"));
    const entries = runtimeLogs.read({ source: "server" }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].message.length).toBeLessThan(8300);
    expect(entries[0].message).toContain("[truncated]");
    expect(entries[1].message).toBe("next");
    child.stderr!.emit("data", Buffer.from(`api_key=${"sensitive-".repeat(40_000)}\n`));
    const legacy = (await service.handle(
      "devServers.logs",
      { id: (await service.list(projects)).servers[0].id },
      projects,
    )) as { output: string };
    expect(legacy.output).not.toContain("sensitive-");
    child.emit("close", 0);
  });
});

it("starts, logs, stops, and restarts a real dedicated test-owned command", async () => {
  const windows = process.platform === "win32";
  const script = `const http=require("node:http");const s=http.createServer((q,r)=>r.end("owned"));s.listen(0,"127.0.0.1",()=>console.log("MANAGED_READY"));process.on("SIGTERM",()=>s.close(()=>process.exit(0)));`;
  const quote = (value: string) =>
    windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
  // Windows PowerShell 5's native argument marshaller strips embedded double
  // quotes; encode the test program so this verifies lifecycle independently.
  const program = `eval(Buffer.from('${Buffer.from(script).toString("base64")}','base64').toString())`;
  const command = `${windows ? "& " : ""}${quote(process.execPath)} -e ${quote(program)}`;
  const service = new DevServersService({
    graceMs: 100,
    shellProfile: {
      id: "test-shell",
      name: "Test shell",
      kind: windows ? "powershell" : "sh",
      path: windows
        ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "/bin/sh",
    },
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      realChildren.push(child);
      return child;
    }) as typeof spawn,
  });
  const started = (await service.handle(
    "devServers.start",
    { name: "Owned test", command, projectId: "project" },
    projects,
  )) as DevServerStartResult;
  realManaged.push({ service, id: started.server!.id });
  const until = Date.now() + 10_000;
  let server: DevServer | undefined;
  do {
    server = (await service.list(projects, true)).servers.find(
      (entry) => entry.id === started.server!.id,
    );
    if (server?.state === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < until);
  const startupLogs = (await service.handle(
    "devServers.logs",
    { id: started.server!.id },
    projects,
  )) as { output: string };
  expect(server, startupLogs.output).toMatchObject({ managed: true, state: "running" });
  expect(server!.endpoints.length).toBeGreaterThan(0);
  expect(await service.handle("devServers.logs", { id: server!.id }, projects)).toMatchObject({
    available: true,
    output: expect.stringContaining("MANAGED_READY"),
  });
  const stopped = (await service.handle("devServers.stop", { id: server!.id }, projects)) as {
    requiresForce: boolean;
  };
  if (stopped.requiresForce) await service.handle("devServers.kill", { id: server!.id }, projects);
  const restarted = (await service.handle(
    "devServers.restart",
    { id: server!.id },
    projects,
  )) as DevServerStartResult;
  realManaged.push({ service, id: restarted.server!.id });
  expect(restarted.server).toMatchObject({ managed: true, command, cwd: process.cwd() });
  expect(restarted.server!.id).not.toBe(server!.id);
  const restartUntil = Date.now() + 10_000;
  do {
    const current = (await service.list(projects, true)).servers.find(
      (entry) => entry.id === restarted.server!.id,
    );
    if (current?.state === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < restartUntil);
}, 60_000);
