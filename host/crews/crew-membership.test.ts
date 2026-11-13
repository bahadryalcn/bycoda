import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import { readCrewRun, readCrewState, writeCrewState } from "./crew-scheduler-projection";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import type { HostModelCatalog, HostSession } from "../../src/features/connections/model/protocol";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
} from "../../src/features/crews/model/crew";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

const catalog = (): HostModelCatalog => ({
  models: { codex: [{ id: "codex:fixture", harness: "codex", name: "Fixture" }] },
  errors: {},
});

const profile = (id: string, role: CrewAgent["role"], name = id): CrewAgent => ({
  id,
  name,
  role,
  instructions: `${name} instructions`,
  selection: "fixed",
  candidates: [
    {
      id: `${id}-model`,
      harness: "codex",
      model: "codex:fixture",
      modelSettings: {},
      capabilities: {},
    },
  ],
});

async function fixture() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject("/membership", "Membership");
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
  const restart = () =>
    new HostCrews(
      store,
      {
        command: vi.fn(() => ({ sessionId: "coordinator" })),
        updateSession: vi.fn(),
      } as unknown as HostEngine,
      { list: () => [], tick: vi.fn() } as unknown as HostTasks,
      async () => catalog(),
      () => now++,
    );
  const service = restart();
  const list = (host = service) => host.call("crews.list", {}, project.id);
  const saveAgent = (agent: CrewAgent, expectedUpdatedAt?: number, projectId?: string) =>
    service.call(
      "crews.agent.save",
      { agent: { ...agent, ...(projectId ? { projectId } : {}) }, expectedUpdatedAt },
      project.id,
    ) as Promise<CrewAgent & { updatedAt: number }>;
  const linked = (library: CrewAgent & { updatedAt: number }, id: string): CrewAgent => ({
    ...library,
    id,
    source: { id: library.id, updatedAt: library.updatedAt },
  });
  const crew = (id: string, members: CrewAgent[], projectId?: string): CrewDefinition => ({
    id,
    name: id,
    ...(projectId ? { projectId } : {}),
    agents: [profile(`${id}-lead`, "coordinator"), ...members, profile(`${id}-rev`, "reviewer")],
    policy: defaultCrewPolicy,
    updatedAt: 0,
  });
  const definition = async (id: string) =>
    (await readCrewState(store)).definitions.find((d) => d.id === id)!;
  const member = async (id: string) => (await definition(id)).agents[1]!;
  return { store, service, restart, list, saveAgent, crew, linked, member, definition, project };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Library profile `lib` ("Ada") followed by two crews, after the migration marker is set. */
async function linkedCrews(f: Fixture) {
  await f.list();
  const lib = await f.saveAgent(profile("lib", "specialist", "Ada"));
  await f.service.save(f.crew("one", [f.linked(lib, "one-ada")]));
  await f.service.save(f.crew("two", [f.linked(lib, "two-ada")]));
  return lib;
}

describe("crew membership links", () => {
  it("syncs a library edit to every crew that follows the profile", async () => {
    const f = await fixture();
    const lib = await linkedCrews(f);
    const before = [(await f.definition("one")).updatedAt, (await f.definition("two")).updatedAt];
    const saved = await f.saveAgent(
      { ...profile("lib", "coordinator", "Ada Lovelace"), instructions: "Compute", handle: "ada" },
      lib.updatedAt,
    );
    for (const [index, crewId] of ["one", "two"].entries()) {
      const synced = await f.member(crewId);
      expect(synced).toMatchObject({
        id: `${crewId}-ada`,
        role: "specialist",
        name: "Ada Lovelace",
        instructions: "Compute",
        handle: "ada",
        source: { id: "lib", updatedAt: saved.updatedAt },
      });
      expect(synced.customized).toBeUndefined();
      expect((await f.definition(crewId)).updatedAt).toBeGreaterThan(before[index]!);
    }
  });

  it("leaves a customized member alone and keeps the revision of an unchanged crew", async () => {
    const f = await fixture();
    const lib = await linkedCrews(f);
    const one = await f.definition("one");
    const mine = { ...one.agents[1]!, instructions: "Crew specific" };
    await f.service.save({ ...one, agents: [one.agents[0]!, mine, one.agents[2]!] }, one.updatedAt);
    expect(await f.member("one")).toMatchObject({ customized: true });
    const v2 = await f.saveAgent(profile("lib", "specialist", "Ada v2"), lib.updatedAt);
    expect(await f.member("one")).toMatchObject({
      name: "Ada",
      instructions: "Crew specific",
      source: { updatedAt: lib.updatedAt },
    });
    expect(await f.member("two")).toMatchObject({ name: "Ada v2" });
    // Saving identical content again only refreshes the link revision.
    const stable = (await f.definition("two")).updatedAt;
    const v3 = await f.saveAgent(profile("lib", "specialist", "Ada v2"), v2.updatedAt);
    expect(await f.member("two")).toMatchObject({ source: { updatedAt: v3.updatedAt } });
    expect((await f.definition("two")).updatedAt).toBe(stable);
  });

  it("marks a linked member customized when its crew edits it, but keeps an equal re-link", async () => {
    const f = await fixture();
    await linkedCrews(f);
    const one = await f.definition("one");
    const resaved = await f.service.save(one, one.updatedAt);
    expect(resaved.agents[1]!.customized).toBeUndefined();
    const renamed = { ...resaved.agents[1]!, name: "Renamed" };
    const next = await f.service.save(
      { ...resaved, agents: [resaved.agents[0]!, renamed, resaved.agents[2]!] },
      resaved.updatedAt,
    );
    expect(next.agents[1]).toMatchObject({ customized: true, source: { id: "lib" } });
  });

  it("respects project scope", async () => {
    const f = await fixture();
    await f.list();
    const local = await f.saveAgent(profile("local", "specialist"), undefined, f.project.id);
    await f.service.save(f.crew("in", [f.linked(local, "in-local")], f.project.id));
    await f.service.save(f.crew("global", [f.linked(local, "global-local")]));
    await f.saveAgent(
      { ...profile("local", "specialist", "Local v2") },
      local.updatedAt,
      f.project.id,
    );
    expect((await f.member("in")).name).toBe("Local v2");
    expect((await f.member("global")).name).toBe("local");
  });

  it("detaches linked members when the library profile is deleted", async () => {
    const f = await fixture();
    await linkedCrews(f);
    await f.service.call("crews.agent.delete", { agentId: "lib" }, f.project.id);
    for (const crewId of ["one", "two"]) {
      const kept = await f.member(crewId);
      expect(kept).toMatchObject({ name: "Ada", instructions: "Ada instructions" });
      expect(kept.source).toBeUndefined();
      expect(kept.customized).toBeUndefined();
    }
  });

  it("rejects a stale library revision without touching crews", async () => {
    const f = await fixture();
    const lib = await linkedCrews(f);
    await expect(
      f.saveAgent(profile("lib", "specialist", "Stale"), lib.updatedAt - 1),
    ).rejects.toThrow("Agent changed");
    expect((await f.member("one")).name).toBe("Ada");
  });

  it("syncs a tool profile, clears it with the library, and keeps a run's snapshot", async () => {
    const f = await fixture();
    const lib = await linkedCrews(f);
    const tools = { preset: "read-only" as const };
    const withTools = await f.saveAgent(
      { ...profile("lib", "specialist", "Ada"), tools },
      lib.updatedAt,
    );
    expect((await f.member("one")).tools).toEqual(tools);
    expect((await f.member("two")).customized).toBeUndefined();
    await f.service.startRun(f.project.id, "one", "Build", "run", "supervised");
    await f.saveAgent(profile("lib", "specialist", "Ada"), withTools.updatedAt);
    expect((await f.member("one")).tools).toBeUndefined();
    const run = await readCrewRun(f.store, "run");
    expect(run!.definition.agents.find((a) => a.id === "one-ada")!.tools).toEqual(tools);
  });

  it("keeps a started run's snapshot when the library changes", async () => {
    const f = await fixture();
    const lib = await linkedCrews(f);
    await f.service.startRun(f.project.id, "one", "Build", "run", "supervised");
    const before = await readCrewRun(f.store, "run");
    await f.saveAgent(profile("lib", "specialist", "Changed"), lib.updatedAt);
    expect((await f.member("one")).name).toBe("Changed");
    const after = await readCrewRun(f.store, "run");
    expect(after!.definition).toEqual(before!.definition);
    expect(after!.definition.agents.find((a) => a.id === "one-ada")!.name).toBe("Ada");
  });
});

describe("membership migration", () => {
  /** Rewinds to a pre-migration store: one edited member, one dangling, one equal. */
  async function unmigrated(f: Fixture) {
    const lib = await linkedCrews(f);
    const state = await readCrewState(f.store);
    const one = state.definitions.find((d) => d.id === "one")!;
    one.agents[1] = { ...one.agents[1]!, name: "Edited in crew" };
    const two = state.definitions.find((d) => d.id === "two")!;
    two.agents[1] = { ...two.agents[1]!, source: { id: "gone", updatedAt: 1 } };
    state.definitions.push(f.crew("three", [f.linked(lib, "three-ada")]));
    delete state.membershipLinked;
    await f.store.transaction(() => writeCrewState(f.store, state));
  }

  it("links equal members, customizes different ones and drops missing sources", async () => {
    const f = await fixture();
    await unmigrated(f);
    await f.list();
    expect(await f.member("one")).toMatchObject({ customized: true, source: { id: "lib" } });
    expect((await f.member("two")).source).toBeUndefined();
    const three = await f.member("three");
    expect(three.source?.id).toBe("lib");
    expect(three.customized).toBeUndefined();
  });

  it("does not replay after a restart", async () => {
    const f = await fixture();
    await unmigrated(f);
    await f.list();
    const state = await readCrewState(f.store);
    expect(state.membershipLinked).toBe(true);
    const three = state.definitions.find((d) => d.id === "three")!;
    three.agents[1] = { ...three.agents[1]!, name: "Hand edit" };
    await f.store.transaction(() => writeCrewState(f.store, state));
    await f.list(f.restart());
    const again = await f.member("three");
    expect(again).toMatchObject({ name: "Hand edit", source: { id: "lib" } });
    expect(again.customized).toBeUndefined();
    expect((await f.definition("three")).updatedAt).toBe(three.updatedAt);
  });
});
