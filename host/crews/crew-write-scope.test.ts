import { forEachAsync } from "../async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import {
  initializeCrewSchedulerProjection,
  readCrewState,
  writeCrewState,
} from "./crew-scheduler-projection";
import { defaultCrewPolicy, type CrewRun } from "../../src/features/crews/model/crew";

const stores: HostStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await forEachAsync(stores.splice(0), async (store) => await store.close());
});

const run = (id: string, extra: Partial<CrewRun> = {}): CrewRun => ({
  id,
  projectId: "project",
  definition: { id: "crew", name: "Crew", agents: [], policy: defaultCrewPolicy, updatedAt: 1 },
  status: "active",
  coordinatorSessionId: `session-${id}`,
  assignments: [],
  messages: [],
  notifications: {},
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

async function setup(...runs: CrewRun[]) {
  const store = new HostStore(":memory:");
  stores.push(store);
  await initializeCrewSchedulerProjection(store);
  const state = await readCrewState(store);
  await store.transaction(() => writeCrewState(store, { ...state, runs }));
  return store;
}
const stored = async (store: HostStore) =>
  (await readCrewState(store)).runs.map((entry) => [entry.id, entry.updatedAt]);
const written = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO crew_runs_v2"));

describe("crew state writes", () => {
  it("writes back only the run that changed and never rescans the history table", async () => {
    const store = await setup(run("a"), run("b"), run("c", { status: "finished" }));
    const state = await readCrewState(store);
    state.runs[1] = { ...state.runs[1], updatedAt: 9 };
    const prepare = vi.spyOn(store.db, "prepare");
    await store.transaction(() => writeCrewState(store, state));
    expect(written(prepare)).toHaveLength(1);
    expect(
      prepare.mock.calls.some(([sql]) => /SELECT ordinal,payload FROM crew_runs_v2/.test(sql)),
    ).toBe(false);
    expect(await stored(store)).toEqual([
      ["a", 1],
      ["b", 9],
      ["c", 1],
    ]);
  });

  it("keeps the finish sequence of an unchanged finished run and appends new runs", async () => {
    const store = await setup(run("a", { status: "finished" }));
    const before = await store.db.prepare("SELECT finished_at FROM crew_runs_v2").all();
    const state = await readCrewState(store);
    state.runs.push(run("b"));
    await store.transaction(() => writeCrewState(store, state));
    const rows = await store.db
      .prepare("SELECT run_id,finished_at FROM crew_runs_v2 ORDER BY ordinal")
      .all();
    expect(rows.map((row) => row.run_id)).toEqual(["a", "b"]);
    expect(rows[0].finished_at).toBe(before[0].finished_at);
  });

  it("does not overwrite a row another writer changed in a run this write left alone", async () => {
    const store = await setup(run("a"), run("b"));
    const state = await readCrewState(store);
    await store.db
      .prepare("UPDATE crew_runs_v2 SET payload=? WHERE run_id='a'")
      .run(JSON.stringify(run("a", { updatedAt: 5 })));
    state.runs[1] = { ...state.runs[1], updatedAt: 9 };
    await store.transaction(() => writeCrewState(store, state));
    expect(await stored(store)).toEqual([
      ["a", 5],
      ["b", 9],
    ]);
  });

  it("refuses to write over a different run another writer put at the same position", async () => {
    const store = await setup(run("a"));
    const state = await readCrewState(store);
    await store.db
      .prepare(
        "INSERT INTO crew_runs_v2(ordinal,run_id,project_id,created_at,status,coordinator_session_id,payload) VALUES(1,'other','project',1,'active','s',?)",
      )
      .run(JSON.stringify(run("other")));
    state.runs.push(run("mine"));
    await expect(store.transaction(() => writeCrewState(store, state))).rejects.toThrow(
      "Crew run changed; retry",
    );
    expect(await stored(store)).toEqual([
      ["a", 1],
      ["other", 1],
    ]);
  });

  it("still removes a deleted run and compacts the rows", async () => {
    const store = await setup(run("a"), run("b"), run("c"));
    const state = await readCrewState(store);
    state.runs = state.runs.filter((entry) => entry.id !== "b");
    await store.transaction(() => writeCrewState(store, state));
    expect(await stored(store)).toEqual([
      ["a", 1],
      ["c", 1],
    ]);
  });

  it("falls back to a full rewrite for a state that was not read from the table", async () => {
    const store = await setup(run("a"), run("b"));
    await store.transaction(() =>
      writeCrewState(store, { definitions: [], runs: [run("b", { updatedAt: 3 })] }),
    );
    expect(await stored(store)).toEqual([["b", 3]]);
  });
});
