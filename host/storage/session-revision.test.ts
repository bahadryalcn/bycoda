import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore } from "../store";
import { SessionRevisionConflictError } from "./session-revision";

// Checkpoint timers keep their real exponential schedule; a test may run them faster.
const { requested, clock } = vi.hoisted(() => ({ requested: [] as number[], clock: { speed: 1 } }));
vi.mock("./session-revision", async (original) => {
  const actual = await original<typeof import("./session-revision")>();
  return {
    ...actual,
    persistenceRetryDelay: (failures: number, base?: number) => {
      const delay = actual.persistenceRetryDelay(failures, base);
      requested.push(delay);
      return delay / clock.speed;
    },
  };
});

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  requested.length = 0;
  clock.speed = 1;
});

async function fixture() {
  const store = new HostStore(":memory:");
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject("/revision", "Revision");
  const create = (id: string) =>
    store.save(
      {
        projectId: project.id,
        revision: 1,
        status: "running",
        updatedAt: 1,
        session: {
          id,
          cwd: "/revision",
          title: id,
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
          blocks: [{ id: "a", role: "assistant", text: "before" }],
        },
      } as HostSession,
      { type: "created" },
    );
  const streamed = (value: HostSession, text: string) => {
    const block = { ...value.session.blocks[0], text };
    return store.save(
      { ...value, revision: value.revision + 1, session: { ...value.session, blocks: [block] } },
      { type: "events", text },
      { deferred: true, blockChanges: new Map([[block.id, block]]) },
    );
  };
  const eventRevisions = async (id: string) =>
    (
      await store.db
        .prepare("SELECT revision FROM events WHERE session_id=? ORDER BY revision")
        .all(id)
    ).map((row) => Number(row.revision));
  const trigger = (id: string) => `fail_${id.replaceAll("-", "_")}`;
  const allowCheckpoints = (id: string) => store.db.exec(`DROP TRIGGER IF EXISTS ${trigger(id)}`);
  // One statement batch: no checkpoint can slip through while the failure is replaced.
  const failCheckpoints = (id: string, message: string) =>
    store.db.exec(
      `DROP TRIGGER IF EXISTS ${trigger(id)}; CREATE TRIGGER ${trigger(id)} BEFORE UPDATE ON session_state WHEN NEW.id='${id}' BEGIN SELECT RAISE(ABORT, '${message}'); END`,
    );
  return { store, create, streamed, eventRevisions, failCheckpoints, allowCheckpoints };
}

it("backs off exponentially up to a cap", async () => {
  const { persistenceRetryDelay } =
    await vi.importActual<typeof import("./session-revision")>("./session-revision");
  expect([0, 1, 2, 3, 5, 6, 40].map((failures) => persistenceRetryDelay(failures))).toEqual([
    1_000, 2_000, 4_000, 8_000, 32_000, 60_000, 60_000,
  ]);
});

it("refuses a duplicate, stale or skipped revision before anything is buffered or inserted", async () => {
  const f = await fixture();
  const id = randomUUID();
  const base = await f.create(id);
  const next = await f.streamed(base, "streamed once");

  // The same revision delivered again as a streamed delta must not join the pending rows.
  await expect(f.streamed(base, "stale delta")).rejects.toBeInstanceOf(
    SessionRevisionConflictError,
  );
  await expect(f.streamed(base, "stale delta")).rejects.toMatchObject({
    code: "SESSION_REVISION_CONFLICT",
    sessionId: id,
    headRevision: 2,
    attemptedRevision: 2,
  });
  // Hard writes get the same answer instead of a UNIQUE failure inside the transaction.
  for (const revision of [1, 2, 4])
    await expect(f.store.save({ ...next, revision }, { type: "hard" })).rejects.toBeInstanceOf(
      SessionRevisionConflictError,
    );

  expect((await f.store.session(id)).session.blocks[0].text).toBe("streamed once");
  // The buffered rows are still exactly the accepted ones: the next hard write commits.
  const settled = await f.store.save({ ...next, revision: 3, status: "idle" }, { type: "settled" });
  expect(settled.revision).toBe(3);
  expect(await f.eventRevisions(id)).toEqual([1, 2, 3]);
  expect((await f.store.session(id)).session.blocks[0].text).toBe("streamed once");
});

it("flushes the other sessions when one session cannot be written and reports the failure", async () => {
  const f = await fixture();
  const [poisoned, healthy, alsoHealthy] = [randomUUID(), randomUUID(), randomUUID()];
  // The failing session is first in flush order.
  await f.streamed(await f.create(poisoned), "never written");
  await f.streamed(await f.create(healthy), "written");
  await f.streamed(await f.create(alsoHealthy), "written too");
  await f.failCheckpoints(poisoned, "poisoned fixture");

  await expect(f.store.flushAll()).rejects.toThrow("poisoned fixture");

  expect(await f.eventRevisions(healthy)).toEqual([1, 2]);
  expect(await f.eventRevisions(alsoHealthy)).toEqual([1, 2]);
  expect(await f.eventRevisions(poisoned)).toEqual([1]);
  // The unwritten state stays in memory and is written once the cause is gone.
  expect((await f.store.session(poisoned)).session.blocks[0].text).toBe("never written");
  await f.allowCheckpoints(poisoned);
  await f.store.flushAll();
  expect(await f.eventRevisions(poisoned)).toEqual([1, 2]);
});

it("spaces failed checkpoint retries out, reports them once and stops on a refused constraint", async () => {
  const f = await fixture();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  clock.speed = 200;
  const id = randomUUID();
  const base = await f.create(id);
  await f.failCheckpoints(id, "transient fixture");
  await f.streamed(base, "held in memory");

  await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(4), { timeout: 5_000 });
  expect(requested.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 8_000]);
  const reported = () =>
    errors.mock.calls.filter(([line]) => String(line).includes(`Session ${id} checkpoint failed`));
  expect(reported()).toHaveLength(1);

  await f.failCheckpoints(id, "UNIQUE constraint failed: events.session_id, events.revision");
  await vi.waitFor(() =>
    expect(reported().some(([line]) => String(line).includes("not retrying"))).toBe(true),
  );
  const armed = requested.length;
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(requested).toHaveLength(armed);
  expect(reported().filter(([line]) => String(line).includes("not retrying"))).toHaveLength(1);

  // Nothing was dropped: readers still see the state and a later flush writes it.
  expect((await f.store.session(id)).session.blocks[0].text).toBe("held in memory");
  await f.allowCheckpoints(id);
  await f.store.flushAll();
  expect(await f.eventRevisions(id)).toEqual([1, 2]);
});
