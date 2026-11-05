import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostAssistant, type AssistantPorts } from "./service";
import { AssistantRepository } from "./repository";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const execution = {
  harness: "codex" as const,
  model: "fixture",
  modelSettings: {},
  runtimeMode: "supervised" as const,
  maxRunMinutes: 60,
};
async function fixture(chiefWake?: AssistantPorts["chiefWake"]) {
  const directory = mkdtempSync(join(tmpdir(), "assistant-chief-events-"));
  const path = join(directory, "host.db");
  let now = Date.parse("2026-11-02T12:00:00Z");
  let revision = 0;
  let store = new HostStore(path);
  await store.ready;
  const ports: AssistantPorts = {
    now: () => now,
    listProjects: async () => [{ id: "project", path: directory, name: "Fixture" }],
    createGoal: async () => ({ goalId: "goal" }),
    goalStatus: async () => ({
      status: "running",
      taskIds: [],
      sessionIds: [],
      progress: { done: 0, total: 1 },
      summary: `Status ${revision}`,
    }),
    chiefWake,
  };
  let service = new HostAssistant(store, ports);
  await service.ready;
  closes.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get service() {
      return service;
    },
    get store() {
      return store;
    },
    now: () => now,
    advance: (days: number) => {
      now += days * 86400000;
    },
    change: () => {
      revision++;
    },
    mode: async (autonomy: "report" | "jobs" | "chief") => {
      const profile = (await service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
      await service.request(
        {
          op: "profile.update",
          expectedVersion: profile.version,
          patch: {
            name: "Fixture",
            setupComplete: true,
            enabled: true,
            autonomy,
            execution,
            dailyTokenBudget: 100000,
            quietStart: 0,
            quietEnd: 0,
          },
        },
        "owner",
      );
    },
    create: () =>
      service.request(
        {
          op: "jobs.create",
          title: "Work",
          request: "Do the reviewed work",
          projectId: "project",
          idempotencyKey: "job",
        },
        "owner",
      ),
    events: () =>
      store.db
        .prepare("SELECT id,value FROM assistant_runtime WHERE id LIKE 'chiefEvent:%' ORDER BY id")
        .all(),
    restart: async () => {
      await service.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      service = new HostAssistant(store, ports);
      await service.ready;
    },
  };
}

it.each(["report", "jobs"] as const)(
  "retains %s activity without admitting an unconsumed Chief backlog",
  async (mode) => {
    const f = await fixture();
    await f.mode("jobs");
    await f.create();
    await f.mode(mode);
    for (let index = 0; index < 8; index++) {
      f.advance(400);
      f.change();
      await f.service.tick();
    }
    expect(await f.events()).toEqual([]);
    const history = await f.store.db
      .prepare(
        "SELECT count(*) AS count FROM assistant_activity WHERE json_extract(value,'$.kind')='job.running'",
      )
      .get();
    expect(history!.count).toBeGreaterThanOrEqual(8);
    await f.mode("chief");
    await f.service.tick();
    expect((await f.events()).map((row) => JSON.parse(row.value).value.event.kind)).toEqual([
      "chief.periodicReview",
    ]);
    await f.service.tick();
    expect(await f.events()).toHaveLength(1);
  },
);

it("preserves admitted pending events and unknown intent/action bytes across clock jumps, mode switches and restart", async () => {
  const f = await fixture();
  await f.mode("chief");
  await f.create();
  const pending = await f.events();
  expect(pending.length).toBeGreaterThan(0);
  const repository = new AssistantRepository(f.store);
  const intent = {
    operationId: "unknown-operation",
    status: "unknown",
    day: "2026-11-02",
    tokenCap: 1000,
    eventIds: pending.map((row) => String(row.id).slice("chiefEvent:".length)),
  };
  for (const [id, value] of [
    ["chiefPendingIntent", intent],
    ["chiefAction:unknown-operation:0", "unknown"],
  ] as const)
    await repository.put("runtime", {
      id,
      version: 0,
      createdAt: f.now(),
      updatedAt: f.now(),
      value,
    });
  const unknownBefore = await f.store.db
    .prepare(
      "SELECT id,value FROM assistant_runtime WHERE id IN ('chiefPendingIntent','chiefAction:unknown-operation:0') ORDER BY id",
    )
    .all();
  await f.mode("report");
  f.advance(10000);
  f.change();
  await f.service.tick();
  f.advance(-20000);
  await f.restart();
  await f.service.tick();
  await f.mode("chief");
  await f.service.tick();
  expect(await f.events()).toEqual(pending);
  expect(
    await f.store.db
      .prepare(
        "SELECT id,value FROM assistant_runtime WHERE id IN ('chiefPendingIntent','chiefAction:unknown-operation:0') ORDER BY id",
      )
      .all(),
  ).toEqual(unknownBefore);
});

it("retains in-flight event IDs until the original Chief wake settles, then removes only those IDs", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let eventIds: string[] = [];
  const chiefWake = vi.fn<NonNullable<AssistantPorts["chiefWake"]>>(async ({ events }) => {
    eventIds = events.map((event) => event.id);
    entered.resolve();
    await release.promise;
    return { tokens: 1, actions: [] };
  });
  const f = await fixture(chiefWake);
  await f.mode("chief");
  const creation = f.create();
  void creation.catch(() => {});
  await entered.promise;
  try {
    f.advance(10000);
    expect((await f.events()).map((row) => String(row.id)).sort()).toEqual(
      eventIds.map((id) => `chiefEvent:${id}`).sort(),
    );
    const row = await f.store.db
      .prepare("SELECT value FROM assistant_runtime WHERE id='chiefPendingIntent'")
      .get();
    expect(JSON.parse(row!.value).value.status).toBe("running");
    const event = {
      id: "late-owner-answer",
      version: 1,
      createdAt: f.now(),
      updatedAt: f.now(),
      kind: "ownerQuestion.answer",
      summary: "A newly admitted owner decision",
    };
    await new AssistantRepository(f.store).put("runtime", {
      id: `chiefEvent:${event.id}`,
      version: 0,
      createdAt: f.now(),
      updatedAt: f.now(),
      value: { event },
    });
  } finally {
    release.resolve();
  }
  await creation;
  expect((await f.events()).map((row) => row.id)).toEqual(["chiefEvent:late-owner-answer"]);
  const settled = await f.store.db
    .prepare("SELECT value FROM assistant_runtime WHERE id='chiefIntent'")
    .get();
  expect(JSON.parse(settled!.value).value.status).toBe("settled");
  expect(chiefWake).toHaveBeenCalledOnce();
});
