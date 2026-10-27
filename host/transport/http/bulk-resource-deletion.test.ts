import { afterEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { DesktopSessions } from "../../desktopSessions";
import { HostEngine } from "../../engine";
import { HostNotes } from "../../host-notes";
import { AsyncHostNotes } from "../../host-notes-async";
import { createHostServer } from "../../server";
import { HostStore } from "../../store";
import { parseHostGoal } from "../../../src/features/tasks/model/hostGoals";
import { parseHostTask } from "../../../src/features/tasks/model/hostTasks";
import { HostGoalSchema } from "../../../src/shared/model/host-contracts/goals";
import {
  BulkDescriptorSchema,
  WS_SUBPROTOCOL,
} from "../../../src/shared/model/host-contracts";
import {
  HostBulkTransfers,
  hostBulkDependencies,
  noteBulkDeleteKeys,
  taskBulkDeleteKeys,
  goalBulkDeleteKeys,
  automationBulkDeleteKeys,
} from "./bulk";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-bulk-resource-delete-"));
  const desktopPath = join(directory, "desktop.db");
  const db = new DatabaseSync(desktopPath);
  db.exec(`CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,
    source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);
  db.close();
  // Every desktop/Notes lookup in this Host is confined to this owned fixture.
  vi.stubEnv("BYCODA_DESKTOP_DB", desktopPath);
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      cancel: async () => {},
      stop: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const server = await createHostServer(
    engine,
    [],
    undefined,
    undefined,
    undefined,
    new DesktopSessions(() => []),
  );
  const sockets: WebSocket[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.terminate();
    await server.closeResources();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await engine.close();
    await store.close();
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-bulk-resource-delete-")
    )
      throw new Error("Unexpected owned fixture cleanup path.");
    rmSync(target, { recursive: true, force: true });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = await store.issueDevice("Bulk deletion fixture");
  const headers = { Authorization: `Bearer ${device.token}` };
  const socket = new WebSocket(
    `${base.replace("http:", "ws:")}/ws`,
    WS_SUBPROTOCOL,
    { headers },
  );
  sockets.push(socket);
  await once(socket, "open");
  let sequence = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const id = `bulk-delete-${++sequence}`;
    const pending = new Promise<Record<string, any>>((done, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive);
        reject(new Error(`Fixture timed out: ${method}`));
      }, 5_000);
      const receive = (bytes: Buffer) => {
        const value = JSON.parse(String(bytes));
        if (value.id !== id) return;
        clearTimeout(timer);
        socket.off("message", receive);
        done(value);
      };
      socket.on("message", receive);
    });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return await pending;
  };
  const http = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(`${base}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        version: 1,
        environmentId: store.environmentId,
        method,
        params,
      }),
    });
    expect(response.status).toBe(200);
    return await response.json();
  };
  const hello = await rpc("connection.hello", {
    environmentId: store.environmentId,
    clientId: "bulk-deletion-fixture",
    clientKind: "desktop",
    supportedWireVersions: [2],
    supportedSchemaVersions: [1],
  });
  expect(hello.error).toBeUndefined();
  const retain = async (method: string, params: Record<string, unknown>) => {
    const reply = await rpc(method, params);
    expect(reply.error).toBeUndefined();
    const descriptor = BulkDescriptorSchema.parse(reply.result.$bulk);
    const read = (offset = 0) =>
      fetch(`${base}/ws-bulk/${descriptor.transferId}?offset=${offset}`, {
        headers,
      });
    expect((await read()).status).toBe(200);
    return read;
  };
  return {
    directory,
    desktopPath,
    project,
    server,
    store,
    engine,
    rpc,
    http,
    retain,
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
async function seedTasks(
  host: Fixture,
  projectId = host.project.id,
  prefix = "task",
) {
  for (let i = 0; i < 5; i++)
    await host.server.tasks.save({
      id: `${prefix}-${i}`,
      projectId,
      title: `Private task ${i}`,
      prompt: "private-task-content-".repeat(12_000),
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      status: "todo",
    });
  return (await host.server.tasks.list(projectId))[0]!;
}

function seedNotes(host: Fixture, cwd = host.directory, prefix = "note") {
  const notes = new HostNotes(() => [host.desktopPath]);
  const first = notes.save(
    {
      id: `${prefix}-0`,
      title: "Private note",
      body: "🙂".repeat(500),
      tags: Array.from({ length: 20 }, (_, i) => `${i}-${"tag".repeat(15)}`),
      sourceCwd: cwd,
    },
    0,
  );
  const db = new DatabaseSync(host.desktopPath);
  try {
    const insert = db.prepare(
      "INSERT INTO notes SELECT ?,?,title,body,tags_json,source_session_id,source_cwd,slug_pending,created_at,updated_at,content_updated_at FROM notes WHERE id=?",
    );
    db.exec("BEGIN");
    for (let i = 1; i < 400; i++)
      insert.run(`${prefix}-${i}`, `${prefix}-private-${i}`, first.id);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  return { notes, first };
}

async function seedGoals(
  host: Fixture,
  projectId = host.project.id,
  prefix = "goal",
) {
  const goals = [];
  await host.server.goals.ready;
  for (let i = 0; i < 5; i++) {
    // Seed a valid persisted cancelled goal without launching a provider planner.
    const input = parseHostGoal({
      id: `${prefix}-${i}`,
      title: `Private goal ${i}`,
      prompt: "private-goal-".repeat(18_000),
      projectIds: [projectId],
      leadProjectId: projectId,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      verifyDefaults: { review: false },
    });
    const goal = HostGoalSchema.parse({
      ...input,
      status: "cancelled",
      taskIds: [],
      createdAt: i + 1,
      updatedAt: i + 1,
    });
    await host.store.db
      .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
      .run(goal.id, JSON.stringify(goal));
    goals.push(goal);
  }
  return goals[0]!;
}

async function seedAutomations(
  host: Fixture,
  projectId = host.project.id,
  prefix = "automation",
) {
  const saved = [];
  for (let i = 0; i < 5; i++)
    saved.push(
      await host.server.automations.save({
        id: `${prefix}-${i}`,
        name: `Private automation ${i}`,
        prompt: "private-auto-".repeat(18_000),
        projectId,
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "auto",
        maxRunMinutes: 0,
        scheduleKind: "daily",
        minute: 0,
        time: "09:00",
        dayOfWeek: 1,
        maxRunsPerDay: 0,
        enabled: false,
        isolate: false,
      }),
    );
  return saved[0]!;
}

it.each([
  ["goals", "HTTP"],
  ["goals", "WS"],
  ["automations", "HTTP"],
  ["automations", "WS"],
] as const)(
  "purges a retained %s.list after committed %s deletion",
  async (domain, transport) => {
    const host = await setup();
    const removed =
      domain === "goals" ? await seedGoals(host) : await seedAutomations(host);
    const read = await host.retain(`${domain}.list`, {});
    expect((await (await read()).text()).includes(`"id":"${removed.id}"`)).toBe(
      true,
    );
    const result = await (transport === "HTTP" ? host.http : host.rpc)(
      `${domain}.delete`,
      domain === "goals"
        ? { goalId: removed.id }
        : { automationId: removed.id },
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual({ deleted: true });
    expect(
      await (domain === "goals"
        ? host.server.goals.list()
        : host.server.automations.list()),
    ).toHaveLength(4);
    expect((await read()).status).toBe(404);
  },
);

it("requires the Task ID at owner admission rather than generating it during save", () => {
  const input = {
    projectId: "project",
    title: "Task",
    prompt: "",
    harness: "codex",
    model: "codex:test",
    runtimeMode: "auto",
  };
  expect(() => parseHostTask(input)).toThrow("Invalid task ID");
  expect(
    hostBulkDependencies("tasks.save", {
      task: { ...input, id: "retained-id" },
    }),
  ).toEqual(["task:retained-id"]);
});

it("classifies Goal/Automation item copies separately from unrelated items and retained run history", () => {
  const pool = new HostBulkTransfers({ environmentId: "fixture" });
  try {
    for (const [method, field, prefix, deleteKeys] of [
      ["goals.create", "goal", "goal", goalBulkDeleteKeys],
      [
        "automations.save",
        "automation",
        "automation",
        automationBulkDeleteKeys,
      ],
    ] as const) {
      const affected = pool.begin(
        "owner",
        "environment",
        hostBulkDependencies(method, { [field]: { id: "a" } }),
      );
      const unrelated = pool.begin(
        "owner",
        "environment",
        hostBulkDependencies(method, { [field]: { id: "b" } }),
      );
      expect(affected.dependencyKeys).toEqual([`${prefix}:a`]);
      const value = pool.encode(unrelated, { private: "retained" }, 1) as {
        $bulk: unknown;
      };
      const descriptor = BulkDescriptorSchema.parse(value.$bulk);
      for (const key of deleteKeys({ id: "a" })) pool.invalidate(key);
      expect(() => pool.encode(affected, { private: "late" }, 1)).toThrow(
        "context changed",
      );
      expect(
        pool.chunk("owner", descriptor.transferId, 0).length,
      ).toBeGreaterThan(0);
    }
    expect(
      hostBulkDependencies("automations.runs", { automationId: "a" }),
    ).toEqual(["automation-runs:a"]);
    for (const method of [
      "goals.update",
      "goals.cancel",
      "goals.approve",
      "goals.replan",
      "goals.finalReview.recheck",
    ])
      expect(hostBulkDependencies(method, { goalId: "g" })).toEqual(["goal:g"]);
    for (const method of [
      "goals.delete",
      "automations.delete",
      "automations.runNow",
    ])
      expect(
        hostBulkDependencies(method, { goalId: "g", automationId: "a" }),
      ).toEqual([]);
  } finally {
    pool.close();
  }
});

it.each(["goals", "automations"] as const)(
  "fences captured %s.list before a racing committed delete and serves a fresh baseline",
  async (domain) => {
    const host = await setup();
    const removed =
      domain === "goals" ? await seedGoals(host) : await seedAutomations(host);
    // This fixture has no admitted runs; stop only its empty scheduler so a timer
    // cannot consume the delayed list spy in place of the RPC.
    if (domain === "automations") await host.server.automations.close();
    let captured!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((done) => {
      captured = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    if (domain === "goals") {
      const original = host.server.goals.list.bind(host.server.goals);
      vi.spyOn(host.server.goals, "list").mockImplementationOnce(async () => {
        const snapshot = await original();
        captured();
        await gate;
        return snapshot;
      });
    } else {
      const original = host.server.automations.list.bind(
        host.server.automations,
      );
      vi.spyOn(host.server.automations, "list").mockImplementationOnce(
        async () => {
          const snapshot = await original();
          captured();
          await gate;
          return snapshot;
        },
      );
    }
    const late = host.rpc(`${domain}.list`);
    try {
      await ready;
      expect(
        (
          await host.http(
            `${domain}.delete`,
            domain === "goals"
              ? { goalId: removed.id }
              : { automationId: removed.id },
          )
        ).result,
      ).toEqual({ deleted: true });
    } finally {
      release();
    }
    const stale = await late;
    expect(stale.error).toBeDefined();
    expect(stale.result).toBeUndefined();
    const current = await host.rpc(`${domain}.list`);
    expect(current.error).toBeUndefined();
    expect(current.result).toHaveLength(4);
    expect(
      current.result.some((row: { id: string }) => row.id === removed.id),
    ).toBe(false);
  },
);

it.each([false, true])(
  "preserves Goal child gates, absent deletes and unrelated project/domain copies (withTasks=%s)",
  async (withTasks) => {
    const host = await setup();
    const goal = await seedGoals(host);
    const child = await seedTasks(host);
    await host.store.db
      .prepare("UPDATE goals SET value=? WHERE id=?")
      .run(JSON.stringify({ ...goal, taskIds: [child.id] }), goal.id);
    await host.store.db
      .prepare(
        "UPDATE tasks SET value=json_set(value,'$.status','running') WHERE id=?",
      )
      .run(child.id);
    const otherCwd = join(host.directory, "other-goal");
    mkdirSync(otherCwd);
    const other = await host.engine.openProject(otherCwd);
    await seedTasks(host, other.id, "other-goal-task");
    seedNotes(host, otherCwd, "other-goal-note");
    const read = await host.retain("goals.list", {});
    const unrelatedProject = await host.retain("tasks.list", {
      projectId: other.id,
    });
    const unrelatedDomain = await host.retain("notes.list", {
      projectId: other.id,
    });
    await expect(host.server.goals.delete(goal.id, withTasks)).rejects.toThrow(
      "running tasks",
    );
    expect(
      (await host.rpc("goals.delete", { goalId: goal.id, withTasks })).error,
    ).toBeDefined();
    expect(
      (await host.rpc("goals.delete", { goalId: "absent", withTasks })).result,
    ).toEqual({ deleted: true });
    expect((await read()).status).toBe(200);
    await host.store.db
      .prepare(
        "UPDATE tasks SET value=json_set(value,'$.status','todo') WHERE id=?",
      )
      .run(child.id);
    expect(
      (await host.rpc("goals.delete", { goalId: goal.id, withTasks })).result,
    ).toEqual({ deleted: true });
    expect((await read()).status).toBe(404);
    expect((await unrelatedProject()).status).toBe(200);
    expect((await unrelatedDomain()).status).toBe(200);
    expect(
      (await host.server.tasks.list(host.project.id)).some(
        (row) => row.id === child.id,
      ),
    ).toBe(!withTasks);
    if (withTasks)
      expect(
        (await host.server.tasks.events(0)).events.some(
          (event) => event.taskId === child.id && event.deleted,
        ),
      ).toBe(true);
  },
);

it("preserves Automation running/cleanup gates, existing history cleanup and unrelated project/domain copies", async () => {
  const host = await setup();
  const automation = await seedAutomations(host);
  const otherCwd = join(host.directory, "other-automation");
  mkdirSync(otherCwd);
  const other = await host.engine.openProject(otherCwd);
  await seedTasks(host, other.id, "other-automation-task");
  await seedGoals(host, other.id, "other-automation-goal");
  const run = {
    id: "retained-run",
    automationId: automation.id,
    trigger: "manual",
    scheduledFor: 1,
    createdAt: 1,
    status: "running",
  };
  await host.store.db
    .prepare(
      "INSERT INTO automation_runs(id,automation_id,created_at,value) VALUES(?,?,?,?)",
    )
    .run(run.id, automation.id, 1, JSON.stringify(run));
  const read = await host.retain("automations.list", {});
  const unrelatedProject = await host.retain("tasks.list", {
    projectId: other.id,
  });
  const unrelatedDomain = await host.retain("goals.list", {});
  await expect(host.server.automations.delete(automation.id)).rejects.toThrow(
    "still running",
  );
  expect(
    (await host.rpc("automations.delete", { automationId: automation.id }))
      .error,
  ).toBeDefined();
  expect(
    (await host.rpc("automations.delete", { automationId: "absent" })).result,
  ).toEqual({ deleted: true });
  expect((await read()).status).toBe(200);
  await host.store.db
    .prepare("UPDATE automation_runs SET value=? WHERE id=?")
    .run(
      JSON.stringify({ ...run, status: "succeeded", cleanupPending: true }),
      run.id,
    );
  await expect(host.server.automations.delete(automation.id)).rejects.toThrow(
    "releasing an owned activity",
  );
  expect(
    (await host.rpc("automations.delete", { automationId: automation.id }))
      .error,
  ).toBeDefined();
  expect((await read()).status).toBe(200);
  await host.store.db
    .prepare("UPDATE automation_runs SET value=? WHERE id=?")
    .run(
      JSON.stringify({
        ...run,
        status: "failed",
        cleanupPending: false,
        error: "private-completed-run-".repeat(60_000),
      }),
      run.id,
    );
  const priorRuns = await host.retain("automations.runs", {
    automationId: automation.id,
  });
  expect(
    (await host.rpc("automations.delete", { automationId: automation.id }))
      .result,
  ).toEqual({ deleted: true });
  expect((await read()).status).toBe(404);
  expect((await unrelatedProject()).status).toBe(200);
  expect((await unrelatedDomain()).status).toBe(200);
  expect(
    (await host.rpc("automations.runs", { automationId: automation.id }))
      .result,
  ).toEqual([]);
  expect((await priorRuns()).status).toBe(404);
});

it.each(["goals", "automations"] as const)(
  "retains %s copies after its deletion rolls back",
  async (domain) => {
    const host = await setup();
    const removed =
      domain === "goals" ? await seedGoals(host) : await seedAutomations(host);
    const read = await host.retain(`${domain}.list`, {});
    await expect(
      host.store.transaction(async () => {
        if (domain === "goals") await host.server.goals.delete(removed.id);
        else await host.server.automations.delete(removed.id);
        throw new Error("fixture rollback");
      }),
    ).rejects.toThrow("fixture rollback");
    expect((await read()).status).toBe(200);
    expect(
      (await host.http(`${domain}.list`, {})).result.some(
        (row: { id: string }) => row.id === removed.id,
      ),
    ).toBe(true);
  },
);

it.each(["HTTP", "WS"] as const)(
  "purges a retained tasks.list after committed %s task deletion",
  async (transport) => {
    const host = await setup();
    const removed = await seedTasks(host);
    const read = await host.retain("tasks.list", {
      projectId: host.project.id,
    });
    expect((await (await read()).text()).includes(`"id":"${removed.id}"`)).toBe(
      true,
    );
    const result = await (transport === "HTTP" ? host.http : host.rpc)(
      "tasks.delete",
      { taskId: removed.id, expectedUpdatedAt: removed.updatedAt },
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual({ deleted: true });
    expect(await host.server.tasks.list(host.project.id)).toHaveLength(4);
    expect((await read()).status).toBe(404);
  },
);

it.each(["HTTP", "WS"] as const)(
  "purges a retained notes.list after committed %s note deletion",
  async (transport) => {
    const host = await setup();
    const { notes, first } = seedNotes(host);
    const read = await host.retain("notes.list", {
      projectId: host.project.id,
    });
    expect((await (await read()).text()).includes(`"id":"${first.id}"`)).toBe(
      true,
    );
    const result = await (transport === "HTTP" ? host.http : host.rpc)(
      "notes.delete",
      { id: first.id, expectedUpdatedAt: first.updatedAt },
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual({ deleted: true });
    expect(notes.get(first.id)).toBeNull();
    expect((await read()).status).toBe(404);
  },
);

it("preserves failed/absent Task deletes and unrelated project/domain copies while purging global Task copies", async () => {
  const host = await setup();
  const removed = await seedTasks(host);
  const otherCwd = join(host.directory, "other");
  mkdirSync(otherCwd);
  const other = await host.engine.openProject(otherCwd);
  await seedTasks(host, other.id, "other");
  seedNotes(host);
  const read = await host.retain("tasks.list", { projectId: host.project.id });
  const global = await host.retain("tasks.list", {});
  const unrelatedProject = await host.retain("tasks.list", {
    projectId: other.id,
  });
  const unrelatedDomain = await host.retain("notes.list", {
    projectId: host.project.id,
  });
  expect(
    (
      await host.rpc("tasks.delete", {
        taskId: removed.id,
        expectedUpdatedAt: removed.updatedAt + 1,
      })
    ).error,
  ).toBeDefined();
  expect((await host.rpc("tasks.delete", { taskId: "absent" })).result).toEqual(
    { deleted: true },
  );
  expect((await read()).status).toBe(200);
  expect((await global()).status).toBe(200);
  expect(
    (
      await host.rpc("tasks.delete", {
        taskId: removed.id,
        expectedUpdatedAt: removed.updatedAt,
      })
    ).result,
  ).toEqual({ deleted: true });
  expect((await read()).status).toBe(404);
  expect((await global()).status).toBe(404);
  expect((await unrelatedProject()).status).toBe(200);
  expect((await unrelatedDomain()).status).toBe(200);
});

it("preserves failed Notes CAS and unrelated project/domain copies while purging item and global copies", async () => {
  const host = await setup();
  await seedTasks(host);
  const { notes, first } = seedNotes(host);
  const removed = notes.save(
    { ...first, body: '"'.repeat(600_000) },
    first.updatedAt,
  );
  const otherCwd = join(host.directory, "other");
  mkdirSync(otherCwd);
  const other = await host.engine.openProject(otherCwd);
  seedNotes(host, otherCwd, "other");
  const read = await host.retain("notes.list", { projectId: host.project.id });
  const global = await host.retain("notes.list", {});
  const item = await host.retain("notes.get", { id: removed.id });
  const unrelatedProject = await host.retain("notes.list", {
    projectId: other.id,
  });
  const unrelatedDomain = await host.retain("tasks.list", {
    projectId: host.project.id,
  });
  expect(
    (
      await host.rpc("notes.delete", {
        id: removed.id,
        expectedUpdatedAt: removed.updatedAt + 1,
      })
    ).error,
  ).toBeDefined();
  expect(
    (await host.rpc("notes.delete", { id: "absent", expectedUpdatedAt: 0 }))
      .error,
  ).toBeDefined();
  expect((await read()).status).toBe(200);
  expect((await global()).status).toBe(200);
  expect((await item()).status).toBe(200);
  expect(
    (
      await host.rpc("notes.delete", {
        id: removed.id,
        expectedUpdatedAt: removed.updatedAt,
      })
    ).result,
  ).toEqual({ deleted: true });
  expect((await read()).status).toBe(404);
  expect((await global()).status).toBe(404);
  expect((await item()).status).toBe(404);
  expect((await unrelatedProject()).status).toBe(200);
  expect((await unrelatedDomain()).status).toBe(200);
});

it.each(["tasks.list", "notes.list"] as const)(
  "fences an already captured %s from retaining late deleted data, then serves a fresh baseline",
  async (method) => {
    const host = await setup();
    const task = await seedTasks(host);
    const { first } = seedNotes(host);
    let captured!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((done) => {
      captured = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let held = false;
    if (method === "tasks.list") {
      const original = host.server.tasks.list.bind(host.server.tasks);
      vi.spyOn(host.server.tasks, "list").mockImplementation(
        async (projectId) => {
          const snapshot = await original(projectId);
          if (projectId === host.project.id && !held) {
            held = true;
            captured();
            await gate;
          }
          return snapshot;
        },
      );
    } else {
      const original = AsyncHostNotes.prototype.list;
      vi.spyOn(AsyncHostNotes.prototype, "list").mockImplementation(
        async function (this: AsyncHostNotes, ...args) {
          const snapshot = await original.apply(this, args);
          if (args[0] === host.directory && !held) {
            held = true;
            captured();
            await gate;
          }
          return snapshot;
        },
      );
    }
    const late = host.rpc(method, { projectId: host.project.id });
    try {
      await ready;
      const deletion =
        method === "tasks.list"
          ? await host.http("tasks.delete", {
              taskId: task.id,
              expectedUpdatedAt: task.updatedAt,
            })
          : await host.http("notes.delete", {
              id: first.id,
              expectedUpdatedAt: first.updatedAt,
            });
      expect(deletion.result).toEqual({ deleted: true });
    } finally {
      release();
    }
    const stale = await late;
    expect(stale.error).toBeDefined();
    expect(stale.result).toBeUndefined();
    const fresh = await host.rpc(method, { projectId: host.project.id });
    expect(fresh.error).toBeUndefined();
    if (method === "tasks.list") {
      expect(
        fresh.result.some((row: { id: string }) => row.id === task.id),
      ).toBe(false);
    } else {
      // The remaining preview list is still large; its new transfer must be distinct
      // and its current owner no longer includes the deleted item.
      expect(BulkDescriptorSchema.safeParse(fresh.result.$bulk).success).toBe(
        true,
      );
      expect(
        (
          await host.http("notes.list", { projectId: host.project.id })
        ).result.notes.some((row: { id: string }) => row.id === first.id),
      ).toBe(false);
    }
  },
);

it("retains Task copies after a transaction rolls back its deletion", async () => {
  const host = await setup();
  const task = await seedTasks(host);
  const read = await host.retain("tasks.list", { projectId: host.project.id });
  await expect(
    host.store.transaction(async () => {
      await host.server.tasks.delete(task.id, false, task.updatedAt);
      throw new Error("fixture rollback");
    }),
  ).rejects.toThrow("fixture rollback");
  expect((await read()).status).toBe(200);
  expect(
    (await host.server.tasks.list(host.project.id)).some(
      (row) => row.id === task.id,
    ),
  ).toBe(true);
});

it("publishes the real Notes worker commit before an unrelated HostDB rollback", async () => {
  const host = await setup();
  const { notes, first } = seedNotes(host);
  const worker = new AsyncHostNotes(() => [host.desktopPath]);
  const pool = new HostBulkTransfers({
    environmentId: host.store.environmentId,
  });
  cleanups.push(async () => {
    pool.close();
    await worker.close();
  });
  worker.onDelete = (note) => {
    for (const key of noteBulkDeleteKeys(note)) pool.invalidate(key);
  };
  const lease = pool.begin(
    "owner",
    "project",
    hostBulkDependencies(
      "notes.list",
      { projectId: host.project.id },
      host.directory,
    ),
  );
  const value = pool.encode(lease, { private: "retained" }, 1) as {
    $bulk: unknown;
  };
  pool.release(lease);
  const descriptor = BulkDescriptorSchema.parse(value.$bulk);
  await expect(
    host.store.transaction(async () => {
      await worker.delete(first.id, first.updatedAt, undefined, () => true);
      expect(() => pool.chunk("owner", descriptor.transferId, 0)).toThrow(
        "unavailable",
      );
      throw new Error("fixture rollback");
    }),
  ).rejects.toThrow("fixture rollback");
  expect(notes.get(first.id)).toBeNull();
  expect(() => pool.chunk("owner", descriptor.transferId, 0)).toThrow(
    "unavailable",
  );
});

it("keeps dependency metadata immutable and explicitly classifies item/session/collection results without changing delete acknowledgements", () => {
  const pool = new HostBulkTransfers({ environmentId: "fixture" });
  try {
    const keys = ["task:one"];
    const lease = pool.begin("owner", "environment", keys);
    keys[0] = "task:other";
    const first = pool.encode(lease, { value: "retained" }, 1) as {
      $bulk: unknown;
    };
    const descriptor = BulkDescriptorSchema.parse(first.$bulk);
    const second = pool.begin("owner", "environment", ["task:other"]);
    const unrelated = BulkDescriptorSchema.parse(
      (pool.encode(second, { value: "retained" }, 1) as { $bulk: unknown })
        .$bulk,
    );
    expect(unrelated.transferId).not.toBe(descriptor.transferId);
    pool.invalidate("task:one");
    expect(() => pool.encode(lease, { value: "late" }, 1)).toThrow(
      "context changed",
    );
    expect(() => pool.chunk("owner", descriptor.transferId, 0)).toThrow(
      "unavailable",
    );
    expect(pool.chunk("owner", unrelated.transferId, 0).length).toBeGreaterThan(
      0,
    );
    expect(
      hostBulkDependencies("tasks.reorder", { taskIds: ["a", "b"] }),
    ).toEqual(["task:a", "task:b"]);
    expect(hostBulkDependencies("tasks.save", { task: { id: "a" } })).toEqual([
      "task:a",
    ]);
    expect(hostBulkDependencies("tasks.events", {})).toEqual(["tasks:all"]);
    expect(hostBulkDependencies("notes.upsert", { note: { id: "n" } })).toEqual(
      ["note:n"],
    );
    expect(
      hostBulkDependencies(
        "notes.list",
        { sessionId: "s", projectId: "p" },
        "/p",
      ),
    ).toEqual(["notes:session:s"]);
    expect(
      noteBulkDeleteKeys({ id: "n", sourceCwd: "/p", sourceSessionId: "s" }),
    ).toEqual(["note:n", "notes:all", "notes:cwd:/p", "notes:session:s"]);
    expect(taskBulkDeleteKeys({ id: "t", projectId: "p" })).toEqual([
      "task:t",
      "tasks:project:p",
      "tasks:all",
    ]);
    for (const method of [
      "tasks.delete",
      "notes.delete",
      "projects.list",
      "connection.probe",
    ])
      expect(hostBulkDependencies(method, { taskId: "t", id: "n" })).toEqual(
        [],
      );
  } finally {
    pool.close();
  }
});
