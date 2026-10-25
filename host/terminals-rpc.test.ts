import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { HostTerminals } from "./terminals";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-terminal-rpc-")));
  const projectPath = join(root, "project");
  const otherPath = join(root, "other");
  await mkdir(projectPath);
  await mkdir(otherPath);
  const store = new HostStore(join(root, "host.db"));
  const engine = new HostEngine(store, {});
  const child = { write: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const launch = vi.fn(() => child);
  const terminals = new HostTerminals(launch, () => ({
    profiles: [{ id: "test", name: "Test shell", path: "/test", kind: "sh" }],
    chosenId: null,
    defaultId: "test",
  }));
  const server = await createHostServer(
    engine,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    terminals,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const device = await store.issueDevice("Owner phone");
  const project = await engine.openProject(projectPath);
  const other = await engine.openProject(otherPath);
  const call = async (
    method: string,
    params: Record<string, unknown> = {},
    options: { token?: string; origin?: string; environmentId?: string } = { token: device.token },
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
      },
      body: JSON.stringify({
        version: 1,
        environmentId: options.environmentId ?? store.environmentId,
        method,
        params,
      }),
    });
    return {
      status: response.status,
      body: (await response.json()) as { result?: any; error?: string },
    };
  };
  cleanups.push(async () => {
    await terminals.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, project, other, store, server, device, terminals, child, launch, call };
}

it("requires paired owner authentication and host identity before any terminal dispatch", async () => {
  const s = await setup();
  for (const method of [
    "terminals.list",
    "terminals.create",
    "terminals.read",
    "terminals.write",
    "terminals.interrupt",
    "terminals.close",
  ]) {
    const params = { projectId: s.project.id, requestId: "request-01" };
    expect((await s.call(method, params, {})).status).toBe(401);
    expect(
      (await s.call(method, params, { token: s.device.token, origin: "https://example.com" }))
        .status,
    ).toBe(403);
    expect(
      (await s.call(method, params, { token: s.device.token, environmentId: "other-machine" }))
        .status,
    ).toBe(400);
  }
  await s.store.revokeToken(s.device.token);
  expect(
    (await s.call("terminals.create", { projectId: s.project.id, requestId: "request-02" })).status,
  ).toBe(401);
  expect(s.launch).not.toHaveBeenCalled();
});

it("advertises pipes, deduplicates creation, rejects escaping roots and protects cross-project terminals", async () => {
  const s = await setup();
  expect((await s.call("environment.describe")).body.result.capabilities).toContain("terminals.v1");
  const params = { projectId: s.project.id, requestId: "request-03" };
  const created = await s.call("terminals.create", params);
  expect(created.status).toBe(200);
  expect(created.body.result).toMatchObject({
    projectId: s.project.id,
    transport: "pipe",
    state: "running",
  });
  expect((await s.call("terminals.create", params)).body.result.id).toBe(created.body.result.id);
  expect(s.launch).toHaveBeenCalledTimes(1);
  for (const method of [
    "terminals.read",
    "terminals.write",
    "terminals.interrupt",
    "terminals.close",
  ])
    expect(
      (await s.call(method, { projectId: s.other.id, id: created.body.result.id, data: "never\n" }))
        .body.error,
    ).toContain("unavailable");
  expect(
    (await s.call("terminals.create", { ...params, requestId: "request-04", cwd: s.root })).body
      .error,
  ).toBeTruthy();
  expect(
    (await s.call("terminals.create", { ...params, requestId: "request-05", projectId: "missing" }))
      .body.error,
  ).toBeTruthy();
  expect(s.child.write).not.toHaveBeenCalled();
  expect(s.child.stop).not.toHaveBeenCalled();
  expect(
    (
      await s.call("terminals.write", {
        projectId: s.project.id,
        id: created.body.result.id,
        data: "exact\n",
      })
    ).body.result,
  ).toEqual({ accepted: true });
  expect(s.child.write).toHaveBeenCalledExactlyOnceWith("exact\n");
  expect(
    (await s.call("terminals.close", { projectId: s.project.id, id: created.body.result.id })).body
      .result,
  ).toEqual({ closed: true });
});

it("does not allow read-only scoped log credentials to create or write terminals", async () => {
  const s = await setup();
  await s.store.save(
    {
      projectId: s.project.id,
      revision: 0,
      status: "idle",
      updatedAt: Date.now(),
      session: {
        id: "session",
        cwd: s.project.cwd,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
        title: "Session",
        blocks: [],
        modelSettings: {},
      },
    },
    {},
  );
  const credential = await s.server.runtimeLogAccess.issueSessionGrant("session");
  for (const method of [
    "terminals.list",
    "terminals.create",
    "terminals.read",
    "terminals.write",
    "terminals.interrupt",
    "terminals.close",
  ]) {
    const result = await s.call(
      method,
      { projectId: s.project.id, requestId: "request-06" },
      { token: credential.token },
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("only permit reading runtime logs");
  }
  expect(s.launch).not.toHaveBeenCalled();
});
