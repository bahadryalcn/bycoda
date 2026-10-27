import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HostStore } from "../../store";
import { HostSprints } from "../../sprints";
import * as dto from "../../../src/shared/model/host-contracts/sprints";
import { createHostSprintsService } from "./service";

// Real isolated SQLite. Sprints own planning metadata only: no Engine/provider
// is constructed, and synthetic task snapshots never execute work.
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture() {
  const folder = resolve(await mkdtemp(join(tmpdir(), "bycoda-sprints-domain-")));
  if (
    dirname(folder) !== resolve(tmpdir()) ||
    !basename(folder).startsWith("bycoda-sprints-domain-")
  )
    throw new Error("Unexpected fixture directory");
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  const store = new HostStore(join(folder, "host.db"));
  cleanups.push(() => store.close());
  const clock = { now: 1000 };
  const sprints = new HostSprints(store, () => clock.now);
  await sprints.ready;
  const service = createHostSprintsService({ sprints });
  const context = { authorized: vi.fn(async () => true) };
  const project = { environmentId: "pc", projectId: "a", cwd: "C:/İş/日本語", name: "İş 🧭" };
  const projectKey = JSON.stringify([project.environmentId, project.projectId]);
  const input = {
    id: "one",
    requestId: "create",
    name: "İlk Sprint 日本語 🧭",
    goal: " Preserve the complete goal. ",
    projects: [project],
    capacityPoints: 20.5,
    projectCapacities: { [projectKey]: 10.5 },
    startsAt: 1000,
    endsAt: 2000,
  };
  const task = {
    id: "child",
    projectId: "a",
    title: "Keep task objective",
    status: "todo" as const,
    updatedAt: 1000,
    goalId: "goal",
  };
  const taskKey = JSON.stringify(["pc", "a", "child"]);
  async function ingest(caughtUp = true) {
    return service.ingest(
      {
        input: {
          environmentId: "pc",
          cursor: 0,
          snapshot: { cursor: 0, tasks: [task] },
          visibleProjectIds: ["a"],
          caughtUp,
        },
      },
      context,
    );
  }
  async function rows(table: string) {
    // Table names are test-owned constants, never application input.
    return store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
  }
  return { store, sprints, service, context, clock, project, input, task, taskKey, ingest, rows };
}

describe("paired sprint domain", () => {
  it("preserves the full rich planning DTO and keeps list/get/report read-only", async () => {
    const f = await fixture();
    expect(await f.service.get({ id: "missing" }, f.context)).toBeNull();
    expect(await f.service.get({ id: "missing" }, f.context, { legacy: true })).toBeUndefined();
    const created = await f.service.create({ input: f.input }, f.context);
    const { requestId: _requestId, ...fields } = f.input;
    expect(created).toMatchObject({
      ...fields,
      revision: 1,
      state: "planned",
    });
    expect(dto.HostSprintSchema.safeParse(created).success).toBe(true);
    const before = await f.rows("sprint_ledger");
    const board = await f.service.list({}, f.context);
    const report = await f.service.report({ id: "one" }, f.context);
    expect(dto.SprintBoardSchema.safeParse(board).success).toBe(true);
    expect(dto.SprintReportSchema.safeParse(report).success).toBe(true);
    expect(report).toMatchObject({
      frozen: false,
      sprint: { goal: f.input.goal, projects: [f.project] },
    });
    expect(await f.rows("sprint_ledger")).toEqual(before);
    expect(await f.store.sessions()).toEqual([]);
  });

  it("retains exact receipt idempotency, CAS and nullable update semantics", async () => {
    const f = await fixture();
    const first = await f.service.create({ input: f.input }, f.context);
    const update = {
      id: "one",
      input: {
        requestId: "update",
        expectedRevision: 1,
        goal: null,
        startsAt: null,
        endsAt: null,
        name: "New name",
      },
    };
    const updated = await f.service.update(update, f.context);
    expect(updated).toMatchObject({ name: "New name", revision: 2 });
    expect(updated.goal).toBeUndefined();
    expect(updated.startsAt).toBeUndefined();
    expect(await f.service.update(update, f.context)).toEqual(updated);
    expect(await f.service.create({ input: f.input }, f.context)).toEqual(first);
    await expect(
      f.service.update({ ...update, input: { ...update.input, name: "Different" } }, f.context),
    ).rejects.toThrow("different sprint changes");
    await expect(
      f.service.update(
        { id: "one", input: { requestId: "stale", expectedRevision: 1, name: "stale" } },
        f.context,
      ),
    ).rejects.toThrow("refresh");
    expect((await f.service.get({ id: "one" }, f.context))?.revision).toBe(2);
    expect((await f.rows("sprint_receipts")).map((row) => row.id)).not.toContain("stale");
  });

  it("reconciles retained HTTP receipts after strict WS schema key reordering without new effects", async () => {
    const f = await fixture();
    const first = await f.service.create({ input: f.input }, f.context, { legacy: true });
    const legacyUpdate = {
      id: "one",
      input: { requestId: "update", expectedRevision: 1, name: "Changed once" },
    };
    const updated = await f.service.update(legacyUpdate, f.context, { legacy: true });
    const wsCreate = dto.SprintsCreateParamsSchema.parse({ input: f.input });
    const wsUpdate = dto.SprintsUpdateParamsSchema.parse(legacyUpdate);
    expect(JSON.stringify(wsCreate.input)).not.toBe(JSON.stringify(f.input));
    expect(JSON.stringify(wsUpdate.input)).not.toBe(JSON.stringify(legacyUpdate.input));
    const receipts = await f.rows("sprint_receipts");
    const ledger = await f.rows("sprint_ledger");
    const change = vi.fn();
    f.sprints.onChange = change;
    // The original create receipt remains revision 1 even though current state
    // is revision 2. Successful reconciliation must not rerun either operation.
    expect(await f.service.create(wsCreate, f.context)).toEqual(first);
    expect(await f.service.update(wsUpdate, f.context)).toEqual(updated);
    expect((await f.service.get({ id: "one" }, f.context))?.revision).toBe(2);
    expect(await f.rows("sprint_receipts")).toEqual(receipts);
    expect(receipts.find((row) => row.id === "create")?.payload).toBe(
      JSON.stringify(["create", f.input]),
    );
    expect(await f.rows("sprint_ledger")).toEqual(ledger);
    expect(change).not.toHaveBeenCalled();
  });

  it("preserves every unknown legacy key, array order and type when comparing receipt payloads", async () => {
    const f = await fixture();
    await f.service.create({ input: f.input }, f.context);
    const extension = { nested: { b: 2, a: 1 }, items: [1, "two"], flag: true };
    const original = {
      name: "Changed once",
      expectedRevision: 1,
      requestId: "legacy-update",
      extension,
    };
    const updated = await f.service.update({ id: "one", input: original }, f.context, {
      legacy: true,
    });
    const receipts = await f.rows("sprint_receipts"),
      ledger = await f.rows("sprint_ledger");
    const reordered = {
      extension: { flag: true, items: [1, "two"], nested: { a: 1, b: 2 } },
      requestId: original.requestId,
      expectedRevision: 1,
      name: original.name,
    };
    expect(JSON.stringify(original)).not.toBe(JSON.stringify(reordered));
    expect(
      await f.service.update({ id: "one", input: reordered }, f.context, { legacy: true }),
    ).toEqual(updated);
    const { extension: _extension, ...withoutExtension } = original;
    for (const changed of [
      { ...reordered, extension: { ...reordered.extension, nested: { a: 1, b: 3 } } },
      { ...reordered, extension: { ...reordered.extension, items: ["two", 1] } },
      { ...reordered, extension: { ...reordered.extension, flag: "true" } },
      withoutExtension,
    ]) {
      await expect(
        f.service.update({ id: "one", input: changed }, f.context, { legacy: true }),
      ).rejects.toThrow("different sprint changes");
    }
    // A strict WS retry cannot silently discard old unknown fields either.
    await expect(
      f.service.update({ id: "one", input: withoutExtension }, f.context),
    ).rejects.toThrow("different sprint changes");
    expect(await f.rows("sprint_receipts")).toEqual(receipts);
    expect(await f.rows("sprint_ledger")).toEqual(ledger);
    expect((await f.service.get({ id: "one" }, f.context))?.revision).toBe(2);
  });

  it("fails closed on malformed retained receipt payload without rewriting it", async () => {
    const f = await fixture();
    await f.service.create({ input: f.input }, f.context, { legacy: true });
    await f.store.db
      .prepare("UPDATE sprint_receipts SET payload=? WHERE id=?")
      .run("{broken-json", "create");
    const receipts = await f.rows("sprint_receipts"),
      ledger = await f.rows("sprint_ledger");
    await expect(f.service.create({ input: f.input }, f.context)).rejects.toThrow(
      "different sprint changes",
    );
    expect(await f.rows("sprint_receipts")).toEqual(receipts);
    expect(await f.rows("sprint_ledger")).toEqual(ledger);
    expect((await f.service.get({ id: "one" }, f.context))?.revision).toBe(1);
  });

  it("keeps lifecycle/report history frozen while rollover and later source events progress", async () => {
    const f = await fixture();
    await f.ingest();
    await f.service.create({ input: f.input }, f.context);
    await f.service.plan(
      {
        input: {
          environmentId: "pc",
          projectId: "a",
          taskId: "child",
          sprintId: "one",
          storyPoints: 5,
          expectedRevision: 0,
          requestId: "plan",
        },
      },
      f.context,
    );
    await f.service.start(
      { id: "one", input: { expectedRevision: 1, requestId: "start" } },
      f.context,
    );
    await f.service.complete(
      {
        id: "one",
        input: {
          expectedRevision: 2,
          requestId: "complete",
          rollover: { taskKeys: [f.taskKey], targetSprintId: null },
        },
      },
      f.context,
    );
    const report = await f.service.report({ id: "one" }, f.context);
    expect(report).toMatchObject({
      frozen: true,
      totals: { remainingPoints: 5 },
      tasks: [{ status: "todo", sprintId: "one" }],
    });
    expect((await f.service.list({}, f.context)).planning[0].sprintId).toBeNull();
    await f.service.ingest(
      {
        input: {
          environmentId: "pc",
          cursor: 1,
          fromCursor: 0,
          visibleProjectIds: ["a"],
          events: [
            {
              sequence: 1,
              projectId: "a",
              taskId: "child",
              status: "done",
              effectiveAt: 1500,
              deleted: false,
            },
          ],
        },
      },
      f.context,
    );
    await f.service.archive(
      { id: "one", input: { expectedRevision: 3, requestId: "archive" } },
      f.context,
    );
    const archived = await f.service.report({ id: "one" }, f.context);
    expect(archived.tasks).toEqual(report.tasks);
    expect(archived.ledger).toEqual(report.ledger);
    expect(archived.sprint.state).toBe("archived");
    expect(dto.SprintReportSchema.safeParse(archived).success).toBe(true);
    expect(await f.store.sessions()).toEqual([]);
  });

  it("retains source visibility, cursor gaps and caught-up lifecycle gates", async () => {
    const f = await fixture();
    await f.ingest(false);
    await f.service.create({ input: f.input }, f.context);
    await expect(
      f.service.start({ id: "one", input: { expectedRevision: 1, requestId: "start" } }, f.context),
    ).rejects.toThrow("Refresh all sprint machines");
    const before = await f.rows("sprint_sources");
    await expect(
      f.service.ingest(
        {
          input: {
            environmentId: "pc",
            cursor: 2,
            events: [
              {
                sequence: 2,
                projectId: "a",
                taskId: "child",
                status: "done",
                effectiveAt: 1100,
                deleted: false,
              },
            ],
            visibleProjectIds: ["a"],
          },
        },
        f.context,
      ),
    ).rejects.toThrow("cursor gap");
    await expect(
      f.service.ingest(
        {
          input: {
            environmentId: "pc",
            cursor: 1,
            fromCursor: 0,
            events: [
              {
                sequence: 1,
                projectId: "outside",
                taskId: "secret",
                status: "todo",
                effectiveAt: 1100,
                deleted: false,
              },
            ],
            visibleProjectIds: ["a"],
          },
        },
        f.context,
      ),
    ).rejects.toThrow("visible project scope");
    expect(await f.rows("sprint_sources")).toEqual(before);
    expect((await f.rows("sprint_receipts")).map((row) => row.id)).not.toContain("start");
  });

  it("keeps goal contexts scoped and automatically plans only matching source children", async () => {
    const f = await fixture();
    await f.service.create({ input: f.input }, f.context);
    const context = await f.service.setGoalContext(
      {
        input: {
          environmentId: "pc",
          goalId: "goal",
          sprintId: "one",
          expectedRevision: 0,
          requestId: "goal-context",
        },
      },
      f.context,
    );
    expect(dto.SprintGoalContextSchema.safeParse(context).success).toBe(true);
    await f.service.ingest(
      {
        input: {
          environmentId: "pc",
          cursor: 0,
          snapshot: {
            cursor: 0,
            tasks: [f.task, { ...f.task, id: "other", goalId: "other-goal" }],
          },
          visibleProjectIds: ["a"],
        },
      },
      f.context,
    );
    const board = await f.service.list({}, f.context);
    expect(board.planning).toEqual([
      {
        environmentId: "pc",
        projectId: "a",
        taskId: "child",
        sprintId: "one",
        storyPoints: null,
        revision: 1,
      },
    ]);
    await expect(
      f.service.setGoalContext(
        {
          input: {
            environmentId: "pc",
            goalId: "goal",
            sprintId: null,
            expectedRevision: 0,
            requestId: "stale-context",
          },
        },
        f.context,
      ),
    ).rejects.toThrow("context changed");
    expect(await f.store.sessions()).toEqual([]);
  });

  it("denies revoked work queued behind actual SQLite admission", async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>(),
      queued = Promise.withResolvers<void>();
    const blocker = f.store.db.scope(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const create = f.sprints.create.bind(f.sprints);
    vi.spyOn(f.sprints, "create").mockImplementation((input) => {
      queued.resolve();
      return create(input);
    });
    const pending = f.service.create({ input: f.input }, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await queued.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await blocker;
    await rejection;
    expect(await f.rows("sprints")).toEqual([]);
    expect(await f.rows("sprint_receipts")).toEqual([]);
  });

  it("rechecks a grant inside an admitted transaction before its first concrete write", async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const get = f.sprints.get.bind(f.sprints);
    vi.spyOn(f.sprints, "get").mockImplementation(async (id) => {
      const result = await get(id);
      entered.resolve();
      await release.promise;
      return result;
    });
    const pending = f.service.create({ input: f.input }, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await rejection;
    expect(await f.rows("sprints")).toEqual([]);
    expect(await f.rows("sprint_receipts")).toEqual([]);
  });

  it("rolls back metadata and receipts when authorization is lost during ledger preparation", async () => {
    const f = await fixture();
    await f.service.create({ input: f.input }, f.context);
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const get = f.sprints.get.bind(f.sprints);
    let reads = 0;
    vi.spyOn(f.sprints, "get").mockImplementation(async (id) => {
      const result = await get(id);
      if (++reads === 2) {
        entered.resolve();
        await release.promise;
      }
      return result;
    });
    const pending = f.service.update(
      { id: "one", input: { requestId: "update", expectedRevision: 1, name: "must roll back" } },
      f.context,
    );
    const rejection = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await rejection;
    expect((await get("one"))?.name).toBe(f.input.name);
    expect(await f.rows("sprint_ledger")).toEqual([]);
    expect((await f.rows("sprint_receipts")).map((row) => row.id)).toEqual(["create"]);
  });

  it("finishes accepted mutation storage after only socket wait cancellation", async () => {
    const f = await fixture();
    const controller = new AbortController(),
      entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const get = f.sprints.get.bind(f.sprints);
    vi.spyOn(f.sprints, "get").mockImplementation(async (id) => {
      const result = await get(id);
      entered.resolve();
      await release.promise;
      return result;
    });
    const pending = f.service.create(
      { input: f.input },
      { ...f.context, signal: controller.signal },
    );
    await entered.promise;
    controller.abort();
    release.resolve();
    expect((await pending).id).toBe("one");
    expect((await get("one"))?.revision).toBe(1);
    expect((await f.rows("sprint_receipts")).map((row) => row.id)).toEqual(["create"]);
  });

  it("does not expose a delayed read after revocation or read cancellation", async () => {
    const f = await fixture();
    await f.service.create({ input: f.input }, f.context);
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const report = f.sprints.report.bind(f.sprints);
    vi.spyOn(f.sprints, "report").mockImplementation(async (id) => {
      const result = await report(id);
      entered.resolve();
      await release.promise;
      return result;
    });
    const pending = f.service.report({ id: "one" }, f.context);
    const rejection = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.context.authorized.mockResolvedValue(false);
    release.resolve();
    await rejection;
    // The completed request did not attach an ephemeral creator grant to data.
    expect((await f.sprints.list()).sprints[0].id).toBe("one");
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.service.list({}, { authorized: async () => true, signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });

  it("closes wire params/results while keeping legacy nested receipt bytes and tolerances", async () => {
    const f = await fixture();
    const richer = {
      ...f.input,
      extensionFromLegacy: { purpose: "preserve exact receipt identity" },
    };
    await expect(f.service.create({ input: richer }, f.context)).rejects.toThrow();
    await expect(f.service.list({ unknown: true }, f.context)).rejects.toThrow();
    const created = await f.service.create({ input: richer, outerLegacyExtra: true }, f.context, {
      legacy: true,
    });
    expect(created).not.toHaveProperty("extensionFromLegacy");
    expect(dto.HostSprintSchema.safeParse({ ...created, unknown: true }).success).toBe(false);
    expect(await f.service.create({ input: richer }, f.context, { legacy: true })).toEqual(created);
    await expect(f.service.create({ input: f.input }, f.context, { legacy: true })).rejects.toThrow(
      "different sprint changes",
    );
    await f.ingest();
    await expect(
      f.service.plan(
        {
          input: {
            environmentId: "pc",
            projectId: "a",
            taskId: "child",
            sprintId: "one",
            storyPoints: 4,
            expectedRevision: 0,
            requestId: "unsupported-estimate",
          },
        },
        f.context,
      ),
    ).rejects.toThrow("supported story point estimate");
    expect(await f.store.sessions()).toEqual([]);
  });
});
