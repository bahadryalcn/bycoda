import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-sprints-rpc-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {
        throw new Error("Fixture must not send");
      },
      bind: () => {},
      cancel: async () => {},
      stop: async () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const server = await createHostServer(engine, []);
  let disconnected = false;
  server.on("connection", (socket) => {
    if (disconnected) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const owner = await store.issueDevice("Sprint test owner");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const call = async (method: string, params: unknown = {}, token = owner.token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      ...((await response.json()) as { result?: any; error?: string }),
    };
  };
  const pause = async () => {
    // A network outage must not dispose the one managed graph attached to a
    // live engine. Reject both existing and new connections until it resumes.
    disconnected = true;
    server.closeAllConnections();
  };
  const resume = async () => {
    disconnected = false;
  };
  return { store, engine, project, call, pause, resume };
}

it("exposes planning and source history only to paired owners and retains idempotent sprint writes", async () => {
  const { store, engine, project, call } = await fixture();
  expect((await call("environment.describe")).result.capabilities).toEqual(
    expect.arrayContaining(["tasks.sprints.v1", "tasks.history.v1"]),
  );
  expect((await call("sprints.list", {}, "invalid")).status).toBe(401);
  expect((await call("tasks.snapshotWithCursor", {}, "invalid")).status).toBe(401);
  const input = {
    id: "sprint-1",
    requestId: "create-sprint",
    name: "Release",
    projects: [
      {
        environmentId: store.environmentId,
        projectId: project.id,
        cwd: project.cwd,
        name: project.name,
      },
    ],
    capacityPoints: 13,
    projectCapacities: {},
  };
  const created = await call("sprints.create", { input });
  expect(created.error).toBeUndefined();
  expect(created.result).toMatchObject({ id: input.id, state: "planned", revision: 1 });
  expect((await call("sprints.create", { input })).result).toEqual(created.result);
  expect((await call("sprints.list")).result.sprints).toHaveLength(1);
  expect(
    (
      await call("sprints.update", {
        id: input.id,
        input: { requestId: "bad-revision", expectedRevision: 99, name: "Wrong" },
      })
    ).error,
  ).toBeTruthy();
  const snapshot = (await call("tasks.snapshotWithCursor")).result;
  expect(snapshot).toMatchObject({ tasks: [], cursor: 0 });
  expect(
    (
      await call("sprints.ingest", {
        input: { environmentId: store.environmentId, snapshot, cursor: snapshot.cursor },
      })
    ).error,
  ).toBeUndefined();
  expect(
    (
      await call("sprints.start", {
        id: input.id,
        input: { requestId: "start-sprint", expectedRevision: 1 },
      })
    ).result.state,
  ).toBe("active");
  expect((await call("sprints.report", { id: input.id })).result.frozen).toBe(false);
  const session = await engine.command({
    type: "create",
    commandId: crypto.randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  const grant = (await call("conversation.access.issue", { sessionId: session.sessionId })).result;
  expect(grant?.token).toBeTruthy();
  expect((await call("sprints.list", {}, grant.token)).error).toContain("Conversation Tools");
  expect((await call("tasks.events", { after: 0 }, grant.token)).error).toContain(
    "Conversation Tools",
  );
  expect(
    (await call("conversation.tools.call", { action: "sprints.create", input }, grant.token)).error,
  ).toBeTruthy();
});

it("replays a disconnected source Host journal into a separate planning Host without executing tasks", async () => {
  const coordinator = await fixture();
  const source = await fixture();
  const environmentId = source.store.environmentId;
  const taskId = "remote-task";
  const saved = await source.call("tasks.save", {
    task: {
      id: taskId,
      projectId: source.project.id,
      title: "Remote work",
      prompt: "Manual fixture",
      status: "todo",
      harness: "codex",
      model: "test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
    },
  });
  expect(saved.error).toBeUndefined();
  const input = {
    id: "cross-host",
    requestId: "cross-host-create",
    name: "Two Hosts",
    projects: [
      {
        environmentId,
        projectId: source.project.id,
        cwd: source.project.cwd,
        name: source.project.name,
      },
    ],
    capacityPoints: 8,
    projectCapacities: {},
  };
  expect((await coordinator.call("sprints.create", { input })).error).toBeUndefined();
  const snapshot = (await source.call("tasks.snapshotWithCursor")).result;
  expect(
    (
      await coordinator.call("sprints.ingest", {
        input: { environmentId, snapshot, cursor: snapshot.cursor },
      })
    ).error,
  ).toBeUndefined();
  expect(
    (
      await coordinator.call("sprints.plan", {
        input: {
          environmentId,
          projectId: source.project.id,
          taskId,
          sprintId: input.id,
          storyPoints: 5,
          expectedRevision: 0,
          requestId: "plan-source",
        },
      })
    ).error,
  ).toBeUndefined();
  expect(
    (
      await coordinator.call("sprints.start", {
        id: input.id,
        input: { requestId: "start-cross-host", expectedRevision: 1 },
      })
    ).error,
  ).toBeUndefined();
  expect(
    (await coordinator.call("sprints.report", { id: input.id })).result.totals.remainingPoints,
  ).toBe(5);
  expect((await source.call("tasks.move", { taskId, to: "done" })).error).toBeUndefined();
  await source.pause();
  try {
    await expect(source.call("tasks.events", { after: snapshot.cursor })).rejects.toThrow();
    expect(
      (await coordinator.call("sprints.report", { id: input.id })).result.totals.completedPoints,
    ).toBe(0);
  } finally {
    await source.resume();
  }
  const delta = (await source.call("tasks.events", { after: snapshot.cursor })).result;
  expect(delta.events).toHaveLength(1);
  const ingest = { environmentId, events: delta.events, cursor: delta.cursor };
  expect((await coordinator.call("sprints.ingest", { input: ingest })).error).toBeUndefined();
  expect((await coordinator.call("sprints.ingest", { input: ingest })).error).toBeUndefined();
  const report = (await coordinator.call("sprints.report", { id: input.id })).result;
  expect(report.totals).toMatchObject({ completedPoints: 5, remainingPoints: 0 });
  expect(report.tasks[0]).toMatchObject({ environmentId, taskId, status: "done" });
  expect((await source.call("tasks.list")).result[0].sessionId).toBeUndefined();
  expect((await coordinator.call("tasks.list")).result).toEqual([]);
});
