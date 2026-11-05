import { afterEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WebSocket } from "ws";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { HostCrews } from "./crews";
import { initializeCrewSchedulerProjection, writeCrewState } from "./crew-scheduler-projection";
import { DesktopSessions } from "../desktop/desktopSessions";
import { ModelCatalogCache } from "../providers/model-catalog-cache";
import * as images from "../social/social-images";
import { createHostServer } from "../server";
import { BulkDescriptorSchema, WS_SUBPROTOCOL } from "../../src/shared/model/host-contracts";
import {
  CrewDefinitionSchema,
  CrewRunSchema,
  SavedCrewAgentSchema,
} from "../../src/shared/model/host-contracts/crews";
import {
  CREW_CAPABILITIES,
  defaultCrewPolicy,
  parseCrewAgent,
  parseCrewDefinition,
} from "../../src/features/crews/model/crew";
import { DEFAULT_CREW_REVISION } from "../../src/features/crews/model/crewDefaults";

type Transport = "HTTP" | "WS";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function agent(id: string, role: "coordinator" | "specialist" | "reviewer", large = false) {
  return parseCrewAgent({
    id,
    name: id,
    role,
    instructions: "Retained instructions",
    selection: "fixed",
    // Stay inside the actual manual parser's limits: 20 candidates, 32
    // string-valued settings of 256 code units, seven 500-code-unit sources.
    // Unicode makes these legitimate persisted fields exceed the wire budget.
    candidates: Array.from({ length: large ? 20 : 1 }, (_, index) => ({
      id: `${id}-candidate-${index}`,
      harness: "codex",
      model: "codex:test",
      modelSettings: large
        ? Object.fromEntries(
            Array.from({ length: 32 }, (_, option) => [
              `providerOption${option}`,
              "界".repeat(256),
            ]),
          )
        : {},
      capabilities: large
        ? Object.fromEntries(
            CREW_CAPABILITIES.map((capability) => [
              capability,
              { state: "unknown", observedAt: 1, source: "証".repeat(500) },
            ]),
          )
        : {},
      cost: 1,
    })),
  });
}
function definition(id: string, projectId?: string, large = true) {
  return CrewDefinitionSchema.parse(
    parseCrewDefinition({
      id,
      name: id,
      ...(projectId === undefined ? {} : { projectId }),
      agents: [
        agent(`${id}-lead`, "coordinator", large),
        agent(`${id}-worker`, "specialist"),
        agent(`${id}-reviewer`, "reviewer", large),
      ],
      policy: defaultCrewPolicy,
      updatedAt: 1,
    }),
  );
}
function profile(id: string, projectId?: string) {
  return SavedCrewAgentSchema.parse({
    ...agent(id, "specialist", true),
    ...(projectId === undefined ? {} : { projectId }),
    updatedAt: 1,
  });
}
function run(id: string, projectId: string, snapshot: ReturnType<typeof definition>) {
  return CrewRunSchema.parse({
    id,
    projectId,
    definition: snapshot,
    status: "paused",
    assignments: [],
    messages: [],
    notifications: {},
    launch: {
      candidate: snapshot.agents[0].candidates[0],
      runtimeMode: "supervised",
      prompt: "Retained private launch",
    },
    createdAt: 1,
    updatedAt: 1,
  });
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-crew-bulk-"));
  vi.stubEnv("BYCODA_DESKTOP_DB", join(directory, "absent-desktop.db"));
  // Discovery and native evidence are fixture ports only. No account/CLI/probe
  // process is consulted; owners, SQLite, RPC and bulk routes below are real.
  vi.spyOn(ModelCatalogCache.prototype, "read").mockResolvedValue({
    models: {
      codex: [
        {
          id: "codex:test",
          harness: "codex",
          name: "Fixture",
          settings: Array.from({ length: 32 }, (_, setting) => ({
            id: `fixture-setting-${setting}`,
            label: `Setting ${setting}`,
            kind: "select",
            value: "option-0",
            options: Array.from({ length: 64 }, (_, choice) => ({
              value: `option-${choice}`,
              label: "選".repeat(256),
            })),
          })),
        },
      ],
    },
    errors: {},
  });
  vi.spyOn(images, "probeNativeCodexImageCapability").mockImplementation(
    async (_directory, authorize) => {
      await authorize?.();
      return { available: false } as Awaited<
        ReturnType<typeof images.probeNativeCodexImageCapability>
      >;
    },
  );
  const provider = {
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, { codex: provider });
  const projectA = await engine.openProject(directory);
  const otherDirectory = join(directory, "other");
  mkdirSync(otherDirectory);
  const projectB = await engine.openProject(otherDirectory);
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
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("bycoda-crew-bulk-"))
      throw new Error("Unexpected fixture cleanup path.");
    rmSync(target, { recursive: true, force: true });
  });
  const seed = async (state: {
    definitions?: ReturnType<typeof definition>[];
    agents?: ReturnType<typeof profile>[];
    runs?: ReturnType<typeof run>[];
  }) => {
    await initializeCrewSchedulerProjection(store);
    await store.transaction(() =>
      writeCrewState(store, {
        definitions: [],
        agents: [],
        runs: [],
        defaultsInitialized: true,
        defaultsRevision: DEFAULT_CREW_REVISION,
        defaultInstructionHashes: {},
        ...state,
      }),
    );
  };
  await seed({});
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = await store.issueDevice("Crew bulk fixture");
  const headers = { Authorization: `Bearer ${device.token}` };
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/ws`, WS_SUBPROTOCOL, { headers });
  sockets.push(socket);
  await once(socket, "open");
  let sequence = 0;
  const ws = async (method: string, params: Record<string, unknown>) => {
    const id = `crew-bulk-${++sequence}`;
    const pending = new Promise<Record<string, any>>((done, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive);
        reject(new Error(`Fixture timeout: ${method}`));
      }, 10_000);
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
    return pending;
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
    return { status: response.status, ...(await response.json()) };
  };
  const call = (transport: Transport, method: string, params: Record<string, unknown>) =>
    transport === "HTTP" ? http(method, params) : ws(method, params);
  expect(
    (
      await ws("connection.hello", {
        environmentId: store.environmentId,
        clientId: "crew-bulk-fixture",
        clientKind: "desktop",
        supportedWireVersions: [2],
        supportedSchemaVersions: [1],
      })
    ).error,
  ).toBeUndefined();
  const retain = async (method: string, params: Record<string, unknown>) => {
    const reply = await ws(method, params);
    expect(reply.error).toBeUndefined();
    const descriptor = BulkDescriptorSchema.parse(reply.result.$bulk);
    expect(descriptor.totalBytes).toBeGreaterThan(1024 * 1024);
    const status = async () => {
      const response = await fetch(`${base}/ws-bulk/${descriptor.transferId}?offset=0`, {
        headers,
      });
      await response.arrayBuffer();
      return response.status;
    };
    expect(await status()).toBe(200);
    return { descriptor, status };
  };
  const tasks = async (projectId: string, crewRunId?: string, prefix = "task") => {
    const saved = [];
    for (let i = 0; i < 5; i++)
      saved.push(
        await server.tasks.save({
          id: `${prefix}-${i}`,
          projectId,
          title: `${prefix}-${i}`,
          prompt: "",
          harness: "codex",
          model: "codex:test",
          modelSettings: { providerOption: "metadata".repeat(30_000) },
          runtimeMode: "auto",
          maxRunMinutes: 0,
          isolate: false,
          review: false,
          status: "todo",
          ...(crewRunId ? { crewRunId } : {}),
        }),
      );
    return saved;
  };
  return {
    store,
    server,
    provider,
    projectA,
    projectB,
    seed,
    ws,
    http,
    call,
    retain,
    tasks,
  };
}

it.each(["HTTP", "WS"] as const)(
  "purges global/project definition copies after actual %s deletion while retaining immutable run snapshots",
  async (transport) => {
    for (const global of [false, true]) {
      const f = await setup();
      const target = definition("target-definition", global ? undefined : f.projectA.id);
      const other = definition("other-definition", f.projectB.id);
      const snapshot = run("retained-snapshot", f.projectA.id, target);
      await f.seed({ definitions: [target, other], runs: [snapshot] });
      await f.tasks(f.projectB.id, undefined, "unrelated-definition");
      const a = await f.retain("crews.list", { projectId: f.projectA.id });
      const b = await f.retain("crews.list", { projectId: f.projectB.id });
      const item = await f.retain("crews.inspect", {
        projectId: f.projectA.id,
        definitionId: target.id,
        memberId: target.agents[1].id,
      });
      const preservedSnapshot = await f.retain("crews.get", {
        projectId: f.projectA.id,
        runId: snapshot.id,
      });
      const unrelated = await f.retain("tasks.list", {
        projectId: f.projectB.id,
      });
      const deletion = {
        projectId: f.projectA.id,
        definitionId: target.id,
        expectedUpdatedAt: target.updatedAt,
      };
      expect(
        (
          await f.call(transport, "crews.delete", {
            ...deletion,
            expectedUpdatedAt: target.updatedAt + 1,
          })
        ).error,
      ).toBeTruthy();
      expect(
        (
          await f.call(transport, "crews.delete", {
            ...deletion,
            definitionId: "missing",
          })
        ).error,
      ).toBeTruthy();
      if (!global)
        expect(
          (
            await f.call(transport, "crews.delete", {
              ...deletion,
              projectId: f.projectB.id,
            })
          ).error,
        ).toBeTruthy();
      expect(await a.status()).toBe(200);
      expect(await b.status()).toBe(200);
      expect(await item.status()).toBe(200);
      const removed = await f.call(transport, "crews.delete", deletion);
      expect(removed.error).toBeUndefined();
      expect(removed.result).toEqual({ deleted: true });
      expect(await a.status()).toBe(404);
      expect(await item.status()).toBe(404);
      expect(await b.status()).toBe(global ? 404 : 200);
      expect(await preservedSnapshot.status()).toBe(200);
      expect(await unrelated.status()).toBe(200);
      expect(f.provider.send).not.toHaveBeenCalled();
    }
  },
);

it.each(["HTTP", "WS"] as const)(
  "purges global/project agent catalog copies after actual %s deletion without erasing copied run members",
  async (transport) => {
    for (const global of [false, true]) {
      const f = await setup();
      const target = profile("target-profile", global ? undefined : f.projectA.id);
      const other = profile("other-profile", f.projectB.id);
      const snapshot = run(
        "copied-members",
        f.projectA.id,
        definition("snapshot-only", f.projectA.id),
      );
      await f.seed({
        agents: [
          target,
          other,
          profile("filler-a", f.projectA.id),
          profile("filler-b", f.projectB.id),
        ],
        runs: [snapshot],
      });
      await f.tasks(f.projectB.id, undefined, "unrelated-agent");
      const a = await f.retain("crews.list", { projectId: f.projectA.id });
      const b = await f.retain("crews.list", { projectId: f.projectB.id });
      const preservedSnapshot = await f.retain("crews.get", {
        projectId: f.projectA.id,
        runId: snapshot.id,
      });
      const unrelated = await f.retain("tasks.list", {
        projectId: f.projectB.id,
      });
      const deletion = { projectId: f.projectA.id, agentId: target.id };
      expect(
        (
          await f.call(transport, "crews.agent.delete", {
            ...deletion,
            agentId: "missing",
          })
        ).error,
      ).toBeTruthy();
      if (!global)
        expect(
          (
            await f.call(transport, "crews.agent.delete", {
              ...deletion,
              projectId: f.projectB.id,
            })
          ).error,
        ).toBeTruthy();
      expect(await a.status()).toBe(200);
      expect(await b.status()).toBe(200);
      const removed = await f.call(transport, "crews.agent.delete", deletion);
      expect(removed.error).toBeUndefined();
      expect(removed.result).toEqual({ deleted: true });
      expect(await a.status()).toBe(404);
      expect(await b.status()).toBe(global ? 404 : 200);
      expect(await preservedSnapshot.status()).toBe(200);
      expect(await unrelated.status()).toBe(200);
      expect(f.provider.send).not.toHaveBeenCalled();
    }
  },
);

it.each(["HTTP", "WS"] as const)(
  "purges run read/raw/project-list copies after committed %s deletion and preserves failed/missing revisions",
  async (transport) => {
    const f = await setup();
    const aRun = run("run-a", f.projectA.id, definition("snapshot-a", f.projectA.id));
    const bRun = run("run-b", f.projectB.id, definition("snapshot-b", f.projectB.id));
    await f.seed({ runs: [aRun, bRun] });
    const raw = await f.retain("crews.pause", {
      projectId: f.projectA.id,
      runId: aRun.id,
    });
    const a = await f.retain("crews.get", {
      projectId: f.projectA.id,
      runId: aRun.id,
    });
    const list = await f.retain("crews.list", { projectId: f.projectA.id });
    const other = await f.retain("crews.get", {
      projectId: f.projectB.id,
      runId: bRun.id,
    });
    const current = await f.http("crews.get", {
      projectId: f.projectA.id,
      runId: aRun.id,
    });
    expect(current.error).toBeUndefined();
    const deletion = {
      projectId: f.projectA.id,
      runId: aRun.id,
      expectedUpdatedAt: current.result.updatedAt,
    };
    expect(
      (
        await f.call(transport, "crews.deleteRun", {
          projectId: f.projectA.id,
          runId: aRun.id,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await f.call(transport, "crews.deleteRun", {
          ...deletion,
          expectedUpdatedAt: deletion.expectedUpdatedAt + 1,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await f.call(transport, "crews.deleteRun", {
          ...deletion,
          projectId: f.projectB.id,
        })
      ).error,
    ).toBeTruthy();
    expect(await raw.status()).toBe(200);
    expect(await a.status()).toBe(200);
    expect(await list.status()).toBe(200);
    const removed = await f.call(transport, "crews.deleteRun", deletion);
    expect(removed.error).toBeUndefined();
    expect(removed.result).toEqual({ deleted: true });
    expect(await raw.status()).toBe(404);
    expect(await a.status()).toBe(404);
    expect(await list.status()).toBe(404);
    expect(await other.status()).toBe(200);
    expect(f.provider.send).not.toHaveBeenCalled();
  },
);

it.each(["HTTP", "WS"] as const)(
  "invalidates Crew get/list Task copies after actual %s Task deletion without touching another project",
  async (transport) => {
    const f = await setup();
    const aRun = run("run-a", f.projectA.id, definition("small-a", f.projectA.id, false));
    const bRun = run("run-b", f.projectB.id, definition("small-b", f.projectB.id, false));
    await f.seed({ runs: [aRun, bRun] });
    const [task] = await f.tasks(f.projectA.id, aRun.id, "task-a");
    await f.tasks(f.projectB.id, bRun.id, "task-b");
    const a = await f.retain("crews.get", {
      projectId: f.projectA.id,
      runId: aRun.id,
    });
    const aList = await f.retain("crews.list", { projectId: f.projectA.id });
    const b = await f.retain("crews.get", {
      projectId: f.projectB.id,
      runId: bRun.id,
    });
    const bList = await f.retain("crews.list", { projectId: f.projectB.id });
    expect(
      (
        await f.call(transport, "tasks.delete", {
          taskId: task.id,
          expectedUpdatedAt: task.updatedAt + 1,
        })
      ).error,
    ).toBeTruthy();
    expect(await a.status()).toBe(200);
    expect(await aList.status()).toBe(200);
    const removed = await f.call(transport, "tasks.delete", {
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
    });
    expect(removed.error).toBeUndefined();
    expect(removed.result).toEqual({ deleted: true });
    expect(await a.status()).toBe(404);
    expect(await aList.status()).toBe(404);
    expect(await b.status()).toBe(200);
    expect(await bList.status()).toBe(200);
    const fresh = await f.ws("crews.get", {
      projectId: f.projectA.id,
      runId: aRun.id,
    });
    expect(fresh.error).toBeUndefined();
    expect(fresh.result.tasks.some((row: { id: string }) => row.id === task.id)).toBe(false);
    expect(f.provider.send).not.toHaveBeenCalled();
  },
);

it.each(["definition", "agent", "run"] as const)(
  "fences a captured Crew list before committed %s deletion so it cannot republish a deleted row",
  async (kind) => {
    const f = await setup();
    const target = definition("target-definition", f.projectA.id);
    const savedAgent = profile("target-agent", f.projectA.id);
    const savedRun = run("target-run", f.projectA.id, target);
    await f.seed({
      definitions: kind === "definition" ? [target] : [],
      agents: kind === "agent" ? [savedAgent, profile("filler-agent", f.projectA.id)] : [],
      runs: kind === "run" ? [savedRun] : [],
    });
    const original = HostCrews.prototype.list;
    const captured = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let held = false;
    vi.spyOn(HostCrews.prototype, "list").mockImplementation(async function (
      this: HostCrews,
      projectId,
    ) {
      const result = await original.call(this, projectId);
      if (projectId === f.projectA.id && !held) {
        held = true;
        captured.resolve();
        await release.promise;
      }
      return result;
    });
    const pending = f.ws("crews.list", { projectId: f.projectA.id });
    try {
      await captured.promise;
      const removed = await f.http(
        kind === "definition"
          ? "crews.delete"
          : kind === "agent"
            ? "crews.agent.delete"
            : "crews.deleteRun",
        {
          projectId: f.projectA.id,
          ...(kind === "definition"
            ? { definitionId: target.id, expectedUpdatedAt: target.updatedAt }
            : kind === "agent"
              ? { agentId: savedAgent.id }
              : { runId: savedRun.id, expectedUpdatedAt: savedRun.updatedAt }),
        },
      );
      expect(removed.error).toBeUndefined();
      expect(removed.result).toEqual({ deleted: true });
    } finally {
      release.resolve();
    }
    const late = await pending;
    expect(late.error).toBeTruthy();
    expect(late.result).toBeUndefined();
    const current = await f.http("crews.list", { projectId: f.projectA.id });
    expect(current.error).toBeUndefined();
    const field = kind === "definition" ? "definitions" : kind === "agent" ? "agents" : "runs";
    const deletedId =
      kind === "definition" ? target.id : kind === "agent" ? savedAgent.id : savedRun.id;
    expect(current.result[field].some((row: { id: string }) => row.id === deletedId)).toBe(false);
    expect(f.provider.send).not.toHaveBeenCalled();
  },
);

it("fences a captured Crew detail before Task deletion so a late read cannot publish an old transfer", async () => {
  const f = await setup();
  const aRun = run("run-a", f.projectA.id, definition("small-a", f.projectA.id, false));
  await f.seed({ runs: [aRun] });
  const [task] = await f.tasks(f.projectA.id, aRun.id, "task-a");
  const original = HostCrews.prototype.list;
  const captured = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let held = false;
  vi.spyOn(HostCrews.prototype, "list").mockImplementation(async function (
    this: HostCrews,
    projectId,
  ) {
    const result = await original.call(this, projectId);
    if (projectId === f.projectA.id && !held) {
      held = true;
      captured.resolve();
      await release.promise;
    }
    return result;
  });
  const pending = f.ws("crews.get", {
    projectId: f.projectA.id,
    runId: aRun.id,
  });
  try {
    await captured.promise;
    const removed = await f.http("tasks.delete", {
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
    });
    expect(removed.error).toBeUndefined();
  } finally {
    release.resolve();
  }
  const late = await pending;
  expect(late.error).toBeTruthy();
  expect(late.result).toBeUndefined();
  const current = await f.ws("crews.get", {
    projectId: f.projectA.id,
    runId: aRun.id,
  });
  expect(current.error).toBeUndefined();
  expect(current.result.tasks.some((row: { id: string }) => row.id === task.id)).toBe(false);
});
