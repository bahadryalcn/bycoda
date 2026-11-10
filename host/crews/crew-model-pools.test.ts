import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import { readCrewState } from "./crew-scheduler-projection";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import type { HostModelCatalog, HostSession } from "../../src/features/connections/model/protocol";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewCandidate,
  type CrewDefinition,
  type CrewModelPool,
} from "../../src/features/crews/model/crew";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

const candidate = (id: string, cost = 1, quality?: number): CrewCandidate => ({
  id,
  harness: "codex",
  model: "codex:fixture",
  modelSettings: {},
  capabilities: {},
  cost,
  ...(quality === undefined ? {} : { quality }),
});
const member = (
  id: string,
  role: CrewAgent["role"],
  extra: Partial<CrewAgent> = {},
): CrewAgent => ({
  id,
  name: id,
  role,
  instructions: `${id} instructions`,
  selection: "fixed",
  candidates: [candidate(`${id}-model`)],
  ...extra,
});

async function fixture() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject("/pools", "Pools");
  vi.spyOn(store, "session").mockImplementation(
    async () =>
      ({
        session: {
          runtimeMode: "supervised",
          harness: "codex",
          model: "codex:fixture",
          blocks: [],
        },
        projectId: project.id,
        status: "idle",
      }) as unknown as HostSession,
  );
  let now = 1000;
  const service = new HostCrews(
    store,
    {
      command: vi.fn(() => ({ sessionId: "coordinator" })),
      updateSession: vi.fn(),
    } as unknown as HostEngine,
    { list: () => [], tick: vi.fn() } as unknown as HostTasks,
    async (): Promise<HostModelCatalog> => ({
      models: { codex: [{ id: "codex:fixture", harness: "codex", name: "Fixture" }] },
      errors: {},
    }),
    () => now++,
  );
  const call = (
    action: string,
    input: Record<string, unknown> = {},
    principal?: { projectId: string; sessionId: string },
  ) => service.call(action, input, project.id, principal);
  const savePool = (
    id: string,
    name: string,
    candidates: CrewCandidate[],
    expectedUpdatedAt?: number,
  ) =>
    call("crews.pools.save", {
      pool: { id, name, candidates },
      ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
    }) as Promise<CrewModelPool>;
  const saveAgent = (agent: CrewAgent, expectedUpdatedAt?: number) =>
    call("crews.agent.save", { agent, expectedUpdatedAt }) as Promise<
      CrewAgent & { updatedAt: number }
    >;
  const crew = (id: string, specialist: CrewAgent): CrewDefinition => ({
    id,
    name: id,
    agents: [member(`${id}-lead`, "coordinator"), specialist, member(`${id}-rev`, "reviewer")],
    policy: defaultCrewPolicy,
    updatedAt: 0,
  });
  const stored = async () => readCrewState(store);
  const crewOf = async (id: string) => (await stored()).definitions.find((d) => d.id === id)!;
  return { service, call, savePool, saveAgent, crew, stored, crewOf, project };
}

const automatic = (id: string, poolId: string): CrewAgent =>
  member(id, "specialist", {
    selection: "automatic",
    candidates: [candidate("seed")],
    pool: { id: poolId },
  });

describe("crew model pools", () => {
  it("saves, lists and validates pools at the trust boundary", async () => {
    const f = await fixture();
    const saved = await f.savePool("p1", " Fast ", [candidate("a", 1, 40), candidate("b", 3, 90)]);
    expect(saved).toMatchObject({ id: "p1", name: "Fast" });
    const listed = (await f.call("crews.pools.list")) as { pools: CrewModelPool[] };
    expect(listed.pools).toHaveLength(1);
    await expect(f.savePool("p2", "fast", [candidate("a")])).rejects.toThrow("already exists");
    await expect(f.savePool("p3", "Empty", [])).rejects.toThrow("1 to 20");
    await expect(f.savePool("p3", "  ", [candidate("a")])).rejects.toThrow();
    await expect(f.savePool("p3", "Dup", [candidate("a"), candidate("a")])).rejects.toThrow(
      "Duplicate",
    );
    await expect(f.savePool("p1", "Fast", [candidate("a")], saved.updatedAt - 1)).rejects.toThrow(
      "changed",
    );
    await expect(f.savePool("gone", "Gone", [candidate("a")], 5)).rejects.toThrow("deleted");
  });

  it("limits the number of pools and refuses agent principals", async () => {
    const f = await fixture();
    for (let i = 0; i < 50; i++) await f.savePool(`p${i}`, `Pool ${i}`, [candidate("a")]);
    await expect(f.savePool("extra", "Extra", [candidate("a")])).rejects.toThrow("at most 50");
    await expect(
      f.call("crews.pools.list", {}, { projectId: f.project.id, sessionId: "s" }),
    ).rejects.toThrow("owner");
  });

  it("fills a member from its pool and refuses an unknown pool", async () => {
    const f = await fixture();
    await f.savePool("p1", "Mix", [candidate("a", 1, 40), candidate("b", 3, 90)]);
    const lib = await f.saveAgent(automatic("lib", "p1"));
    expect(lib.candidates.map((c) => c.id)).toEqual(["a", "b"]);
    expect(lib.pool).toEqual({ id: "p1" });
    await f.service.save(f.crew("one", automatic("one-spec", "p1")));
    expect((await f.crewOf("one")).agents[1]!.candidates.map((c) => c.quality)).toEqual([40, 90]);
    await expect(f.saveAgent(automatic("bad", "missing"))).rejects.toThrow("Unknown model pool");
  });

  it("drops the pool reference from a fixed member", async () => {
    const f = await fixture();
    await f.savePool("p1", "Mix", [candidate("a")]);
    const lib = await f.saveAgent({ ...automatic("lib", "p1"), selection: "fixed" });
    expect(lib.pool).toBeUndefined();
  });

  it("refreshes every referencing profile and crew member when a pool is saved", async () => {
    const f = await fixture();
    const pool = await f.savePool("p1", "Mix", [candidate("a", 1, 40)]);
    const lib = await f.saveAgent(automatic("lib", "p1"));
    await f.service.save(f.crew("one", automatic("one-spec", "p1")));
    await f.service.save(
      f.crew("two", { ...lib, id: "two-spec", source: { id: "lib", updatedAt: lib.updatedAt } }),
    );
    const before = await f.crewOf("one");
    await f.savePool("p1", "Mix", [candidate("a", 2, 70), candidate("c", 3, 90)], pool.updatedAt);
    const state = await f.stored();
    expect(state.agents!.find((a) => a.id === "lib")!.candidates.map((c) => c.id)).toEqual([
      "a",
      "c",
    ]);
    const one = await f.crewOf("one");
    expect(one.agents[1]!.candidates.map((c) => c.quality)).toEqual([70, 90]);
    expect(one.updatedAt).toBeGreaterThan(before.updatedAt);
    const two = await f.crewOf("two");
    expect(two.agents[1]!.candidates.map((c) => c.id)).toEqual(["a", "c"]);
    expect(two.agents[1]!.customized).toBeUndefined();
  });

  it("detaches members on delete and keeps their last candidates", async () => {
    const f = await fixture();
    const pool = await f.savePool("p1", "Mix", [candidate("a", 1, 40)]);
    await f.saveAgent(automatic("lib", "p1"));
    await f.service.save(f.crew("one", automatic("one-spec", "p1")));
    await expect(
      f.call("crews.pools.delete", { poolId: "p1", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("changed");
    await f.call("crews.pools.delete", { poolId: "p1", expectedUpdatedAt: pool.updatedAt });
    const state = await f.stored();
    expect(state.pools).toEqual([]);
    const lib = state.agents!.find((a) => a.id === "lib")!;
    expect(lib.pool).toBeUndefined();
    expect(lib.candidates.map((c) => c.id)).toEqual(["a"]);
    const spec = (await f.crewOf("one")).agents[1]!;
    expect(spec.pool).toBeUndefined();
    expect(spec.candidates.map((c) => c.id)).toEqual(["a"]);
    await expect(
      f.call("crews.pools.delete", { poolId: "p1", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("Unknown model pool");
  });
});
