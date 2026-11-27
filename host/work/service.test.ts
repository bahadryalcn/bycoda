import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkRecordSchema,
  type WorkRecord,
  type WorkSubmission,
  type WorkTarget,
} from "../../src/shared/model/host-contracts/work";
import { HostStore } from "../store";
import { HostLimits } from "../limits";
import type { WorkCallbacks } from "./contracts";
import { HostWork } from "./service";

const stores: HostStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const submission = (id = "task"): WorkSubmission => ({
  source: { kind: "task.worker", id, occurrence: "worker:1" },
  projectId: "project",
  payload: { prompt: "Work" },
});
const target: WorkTarget = {
  model: { harness: "codex", model: "model-one", modelSettings: {} },
  runtimeMode: "supervised",
  permissionRevision: "revision:1",
  execution: { kind: "project", projectId: "project" },
};
const receipt = (work: WorkRecord) => ({
  sessionId: `session:${work.id}`,
  runId: `run:${work.id}`,
});
async function setup(now = Date.now) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-work-"));
  directories.push(directory);
  const store = new HostStore(join(directory, "host.db"));
  stores.push(store);
  const limits = new HostLimits(store);
  await limits.save({ maxRunningTasks: 1 });
  const callbacks: WorkCallbacks = {
    resolve: vi.fn(async () => ({ target })),
    launch: vi.fn(async (work, accepted) => {
      const run = receipt(work);
      await accepted(run);
      return run;
    }),
    observe: vi.fn<WorkCallbacks["observe"]>(async () => ({ state: "unknown" })),
    stop: vi.fn(async () => undefined),
    externalRunning: vi.fn(async () => []),
  };
  const work = new HostWork(store, callbacks, limits, now);
  await work.ready;
  return { store, limits, callbacks, work };
}

describe("durable shared Work admission", () => {
  it("skips completed records during reconciliation, scheduling and admission", async () => {
    const { work, callbacks } = await setup();
    const completed = await work.submit(submission("completed"));
    await work.stop(completed.id);
    const queued = await work.submit(submission("queued"));
    const parse = vi.spyOn(WorkRecordSchema, "parse");

    await work.reconcile();
    await work.tick();
    await work.reconcile();

    expect(parse.mock.calls.map(([record]) => record)).not.toContainEqual(
      expect.objectContaining({ id: completed.id }),
    );
    expect(callbacks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ id: queued.id }),
      expect.any(Function),
    );
    expect(callbacks.observe).toHaveBeenCalledWith(expect.objectContaining({ id: queued.id }));
  });

  it("prunes aged completions from the queue and preserves durable replay and ordering", async () => {
    const day = 24 * 60 * 60 * 1000;
    let now = day;
    const { store, work, callbacks, limits } = await setup(() => now);
    const running = await work.submit(submission("running"));
    const old = await work.submit(submission("old"));
    await work.start(old.id);
    const completed = await work.complete(old.id, receipt(old), { status: "succeeded" });
    await work.start(running.id);

    now += 29 * day;
    await work.tick();
    const queue = () => store.db.prepare("SELECT id FROM work_queue ORDER BY sequence").all();
    expect(await queue()).toEqual([{ id: running.id }, { id: old.id }]);

    now += 2 * day;
    await work.tick();
    expect(await queue()).toEqual([{ id: running.id }]);

    const restarted = new HostWork(store, callbacks, limits, () => now);
    const recent = await restarted.submit(submission("recent"));
    await restarted.stop(recent.id);
    expect(await restarted.get(old.id)).toEqual(completed);
    expect(await restarted.submit(submission("old"))).toEqual(completed);
    await expect(
      restarted.submit({ ...submission("old"), payload: { prompt: "Changed" } }),
    ).rejects.toThrow("different input");
    expect((await restarted.list()).map((item) => item.id)).toEqual([
      running.id,
      old.id,
      recent.id,
    ]);
    expect(await queue()).toEqual([{ id: running.id }, { id: recent.id }]);
  });

  it("keeps a live parent reservation while its delegated advisor waits for capacity", async () => {
    const { work, callbacks } = await setup();
    const parent = await work.submit(submission("parent"));
    await work.start(parent.id);
    const advisor = await work.submit({
      source: { kind: "delegation.advisor", id: "advisor", occurrence: "consult:1" },
      projectId: "project",
      rootWorkId: "task:parent",
      payload: { prompt: "Review" },
    });
    expect(await work.start(advisor.id)).toMatchObject({
      state: "waiting",
      wait: { code: "capacity" },
    });
    expect(await work.get(parent.id)).toMatchObject({ state: "running", reserved: true });
    expect(callbacks.launch).toHaveBeenCalledTimes(1);
    await work.complete(parent.id, receipt(parent), { status: "succeeded" });
    expect(await work.start(advisor.id)).toMatchObject({ state: "running", reserved: true });
  });

  it.each([false, true])("releases only explicit pre-send deferral with stop=%s", async (stop) => {
    const { work, callbacks } = await setup();
    const submitted = await work.submit(submission());
    callbacks.launch = async () => {
      if (stop) await work.stop(submitted.id);
      return { deferredBeforeSend: true, wait: { code: "dependency", message: "Paused" } };
    };
    expect(await work.start(submitted.id)).toMatchObject({
      state: stop ? "completed" : "waiting",
      reserved: false,
      dispatchStarted: false,
      stopRequested: stop,
    });
    if (stop) {
      await work.start(submitted.id);
      expect((await work.get(submitted.id)).state).toBe("completed");
    }
  });

  it("retains accepted receipt when helper contradicts admission with deferral", async () => {
    const { work, callbacks } = await setup();
    callbacks.launch = async (item, accepted) => {
      await accepted(receipt(item));
      return { deferredBeforeSend: true, wait: { code: "dependency", message: "Paused" } };
    };
    const item = await work.submit(submission());
    expect(await work.start(item.id)).toMatchObject({
      state: "running",
      reserved: true,
      receipt: receipt(item),
    });
  });

  it("deduplicates concurrent occurrences and rejects changed input", async () => {
    const { work } = await setup();
    const [first, second] = await Promise.all([
      work.submit(submission()),
      work.submit(submission()),
    ]);
    expect(first.id).toBe(second.id);
    expect(await work.list()).toHaveLength(1);
    await expect(work.submit({ ...submission(), payload: { prompt: "Changed" } })).rejects.toThrow(
      "different input",
    );
  });

  it("reserves sole slot before awaited model resolution across competing callers", async () => {
    const { work, callbacks } = await setup();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    callbacks.resolve = vi.fn(async () => {
      await waiting;
      return { target };
    });
    const first = await work.submit(submission("one"));
    const second = await work.submit(submission("two"));
    const started = work.start(first.id);
    // The second admission can race either way; only one may claim capacity.
    const other = work.start(second.id);
    release();
    const results = await Promise.all([started, other]);
    expect(results.filter((item) => item.reserved)).toHaveLength(1);
    expect(results.filter((item) => item.wait?.code === "capacity")).toHaveLength(1);
    expect(callbacks.launch).toHaveBeenCalledTimes(1);
  });

  it("retains unknown launch reservation across restart and never dispatches it twice", async () => {
    const { store, work, callbacks, limits } = await setup();
    callbacks.launch = vi.fn(async () => {
      throw new Error("ACK lost");
    });
    const item = await work.submit(submission());
    await expect(work.start(item.id)).rejects.toThrow("ACK lost");
    const restarted = new HostWork(store, callbacks, limits);
    await restarted.reconcile();
    await restarted.tick();
    expect(await restarted.get(item.id)).toMatchObject({
      state: "unknown",
      reserved: true,
      dispatchStarted: true,
    });
    expect(callbacks.launch).toHaveBeenCalledTimes(1);
    const next = await restarted.submit(submission("next"));
    expect(await restarted.start(next.id)).toMatchObject({
      state: "waiting",
      wait: { code: "capacity" },
    });
  });

  it("recovers lost receipt through exact request identity and releases only settled run", async () => {
    const { store, work, callbacks, limits } = await setup();
    callbacks.launch = vi.fn(async () => {
      throw new Error("ACK lost");
    });
    const item = await work.submit(submission());
    await expect(work.start(item.id)).rejects.toThrow("ACK lost");
    callbacks.observe = vi.fn<WorkCallbacks["observe"]>(async (record) => ({
      state: "completed",
      receipt: receipt(record),
      outcome: { status: "succeeded" },
    }));
    const restarted = new HostWork(store, callbacks, limits);
    await restarted.reconcile();
    expect(callbacks.observe).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: item.requestId }),
    );
    expect(await restarted.get(item.id)).toMatchObject({
      state: "completed",
      reserved: false,
      receipt: receipt(item),
    });
  });

  it("freezes accepted target and rejects stale completion handles", async () => {
    const { work, callbacks } = await setup();
    const item = await work.submit(submission());
    const running = await work.start(item.id);
    callbacks.resolve = vi.fn(async () => ({
      target: { ...target, model: { ...target.model, model: "model-two" } },
    }));
    expect((await work.start(item.id)).target).toEqual(running.target);
    expect(callbacks.resolve).not.toHaveBeenCalled();
    await expect(
      work.complete(item.id, { sessionId: "wrong", runId: "wrong" }, { status: "succeeded" }),
    ).rejects.toThrow("receipt mismatch");
    expect((await work.get(item.id)).reserved).toBe(true);
    await work.complete(item.id, receipt(item), { status: "succeeded" });
    await expect(work.complete(item.id, receipt(item), { status: "failed" })).rejects.toThrow(
      "cannot change",
    );
  });

  it("persists stop intent before exact cancellation and retains slot until retirement", async () => {
    const { work, callbacks } = await setup();
    const item = await work.submit(submission());
    await work.start(item.id);
    callbacks.stop = vi.fn(async (record, run) => {
      expect(await work.get(item.id)).toMatchObject({ stopRequested: true, reserved: true });
      expect(run).toEqual(receipt(item));
      expect(record.receipt).toEqual(run);
    });
    expect(await work.stop(item.id)).toMatchObject({ stopRequested: true, reserved: true });
    expect(callbacks.stop).toHaveBeenCalledTimes(1);
    await work.complete(item.id, receipt(item), { status: "cancelled" });
    expect((await work.get(item.id)).reserved).toBe(false);
  });

  it("stops queued work without invoking provider cancellation", async () => {
    const { work, callbacks } = await setup();
    const item = await work.submit(submission());
    expect(await work.stop(item.id)).toMatchObject({
      state: "completed",
      outcome: { status: "cancelled" },
    });
    await work.start(item.id);
    expect(callbacks.launch).not.toHaveBeenCalled();
    expect(callbacks.stop).not.toHaveBeenCalled();
  });

  it("does not double count an exact external run already owned by Work", async () => {
    const { work, callbacks, limits } = await setup();
    await limits.save({ maxRunningTasks: 2 });
    const first = await work.submit(submission("first"));
    await work.start(first.id);
    callbacks.externalRunning = async () => [receipt(first), receipt(first)];
    const second = await work.submit(submission("second"));
    expect(await work.start(second.id)).toMatchObject({ state: "running" });
    const third = await work.submit(submission("third"));
    expect(await work.start(third.id)).toMatchObject({
      state: "waiting",
      wait: { code: "capacity" },
    });
  });

  it("returns explicit permission waits without consuming capacity or launching", async () => {
    const { work, callbacks } = await setup();
    callbacks.admit = async () => ({ code: "permission", message: "Owner permission required." });
    const item = await work.submit(submission());
    expect(await work.start(item.id)).toMatchObject({
      state: "waiting",
      reserved: false,
      wait: { code: "permission" },
    });
    expect(callbacks.launch).not.toHaveBeenCalled();
    callbacks.admit = async () => undefined;
    expect(await work.start(item.id)).toMatchObject({ state: "running" });
  });

  it("fences stop racing command acceptance without discarding accepted receipt", async () => {
    const { work, callbacks } = await setup();
    callbacks.launch = vi.fn(async (record, accepted) => {
      await work.stop(record.id);
      await accepted(receipt(record));
      throw new Error("Provider effect must not execute.");
    });
    const item = await work.submit(submission());
    await expect(work.start(item.id)).rejects.toThrow("Work stopped before provider admission.");
    expect(await work.get(item.id)).toMatchObject({
      state: "unknown",
      reserved: true,
      stopRequested: true,
      receipt: receipt(item),
    });
  });

  it("preserves queued identity when reopening a legacy queue", async () => {
    const { work, store, callbacks } = await setup();
    const item = await work.submit(submission());
    await store.db.exec(`
      ALTER TABLE work_queue RENAME TO work_queue_current;
      CREATE TABLE work_queue (id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, value TEXT NOT NULL);
      INSERT INTO work_queue(rowid,id,source_key,value)
        SELECT sequence,id,source_key,value FROM work_queue_current;
      DROP TABLE work_queue_current;
      DROP TABLE work_history;
    `);
    await store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new HostStore(join(directories[directories.length - 1]!, "host.db"));
    stores.push(reopened);
    const restarted = new HostWork(reopened, callbacks, new HostLimits(reopened));
    expect(await restarted.submit(submission())).toMatchObject({
      id: item.id,
      requestId: item.requestId,
      state: "queued",
    });
  });

  it("does not silently drop non-JSON producer input", async () => {
    const { work } = await setup();
    await expect(work.submit({ ...submission(), payload: { prompt: undefined } })).rejects.toThrow(
      "only JSON values",
    );
    expect(await work.list()).toHaveLength(0);
  });

  it("counts external runs against project and global capacity", async () => {
    const { work, callbacks, limits } = await setup();
    await limits.save({ maxRunningTasks: 10 });
    callbacks.projectConcurrency = async () => 1;
    callbacks.externalRunning = async () => [
      { sessionId: "external", runId: "run", projectId: "project" },
    ];
    const item = await work.submit(submission());
    expect(await work.start(item.id)).toMatchObject({
      state: "waiting",
      wait: { code: "projectCapacity" },
    });
    expect(callbacks.launch).not.toHaveBeenCalled();
  });
});
