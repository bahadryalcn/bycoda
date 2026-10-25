import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostCrews } from "./crews";
import { LEGACY_DEFAULT_INSTRUCTION_HASHES } from "./crew-defaults";
import { createHash } from "node:crypto";
import legacyInstructions from "./fixtures/crew-default-instructions.v1.json";
import type { HostTasks } from "./tasks";
import type { HostEngine } from "./engine";
import type { HostModelCatalog } from "../src/features/connections/model/protocol";
import { parseCrewDefinition } from "../src/features/crews/model/crew";
import {
  createDefaultCrew,
  DEFAULT_CREW_ID,
  DEFAULT_CREW_REVISION,
} from "../src/features/crews/model/crewDefaults";

const stores: HostStore[] = [];
afterEach(async () => await (await stores.splice(0)).forEach(async (store) => await store.close()));

const catalog: HostModelCatalog = {
  models: {
    codex: [
      {
        id: "codex:fixture",
        harness: "codex",
        name: "Fixture",
        settings: [
          {
            id: "effort",
            label: "Effort",
            kind: "select",
            value: "medium",
            options: [{ value: "medium", label: "Medium" }],
          },
        ],
      },
    ],
  },
  errors: {},
};

async function fixture() {
  const store = new HostStore(":memory:");
  await stores.push(store);
  const project = await store.addProject("/default-crews", "Default crews");
  const other = await store.addProject("/other-crews", "Other crews");
  const models = vi.fn(async (): Promise<HostModelCatalog> => structuredClone(catalog));
  const engine = { command: vi.fn(), updateSession: vi.fn() };
  const tasks = { list: () => [], tick: vi.fn() };
  let now = 1000;
  const restart = () =>
    new HostCrews(
      store,
      engine as unknown as HostEngine,
      tasks as unknown as HostTasks,
      models,
      () => now++,
    );
  const service = restart();
  const list = (projectId = project.id) => service.call("crews.list", {}, projectId);
  return { store, service, restart, models, engine, tasks, project, other, list };
}

/** Historical instructions stay fixed when current role guidance evolves. */
function legacySeed() {
  const seed = createDefaultCrew(catalog, 10)!;
  seed.agents = seed.agents.filter((agent) => Object.hasOwn(legacyInstructions, agent.id));
  for (const agent of seed.agents) {
    agent.instructions = legacyInstructions[agent.id as keyof typeof legacyInstructions];
    expect(createHash("sha256").update(agent.instructions).digest("hex")).toBe(
      LEGACY_DEFAULT_INSTRUCTION_HASHES[agent.id],
    );
  }
  seed.definition.agents = seed.agents.map(({ updatedAt, ...agent }) => ({
    ...structuredClone(agent),
    source: { id: agent.id, updatedAt },
  }));
  return { ...seed, definitions: [seed.definition], runs: [], defaultsInitialized: true };
}

async function persistLegacy(store: HostStore, state: unknown) {
  await store.db
    .prepare(
      "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run("crews.v1", JSON.stringify(state));
}

describe("editable bycoda defaults", () => {
  it("adds one valid host-wide example and reusable specialties without running work", async () => {
    const f = await fixture();
    await f.list();
    const view = await f.service.list(f.project.id);
    expect(view.definitions).toHaveLength(1);
    const definition = view.definitions[0]!;
    expect(parseCrewDefinition(definition)).toEqual(definition);
    // The JSON-form save endpoint accepts at most 100000 characters.
    expect(JSON.stringify(definition).length).toBeLessThan(100000);
    expect(definition.agents.every((member) => member.instructions.length < 12000)).toBe(true);
    expect(definition).toMatchObject({
      id: DEFAULT_CREW_ID,
      name: "bycoda Product Team",
      policy: { maxParallel: 2, allowSubagents: false, delegateApprovals: false },
    });
    expect(definition.projectId).toBeUndefined();
    expect(view.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining([
        "Team Lead",
        "Project Manager",
        "Product Manager",
        "UX Researcher",
        "UX Designer",
        "UI Engineer",
        "Designer",
        "Mobile Engineer",
        "Backend Engineer",
        "Database Administrator (DBA)",
        "Data Engineer",
        "Architect",
        "DevOps Engineer",
        "Tester",
        "Security Engineer",
        "Accessibility Specialist",
        "Reviewer",
      ]),
    );
    for (const member of definition.agents) {
      expect(member.instructions.length).toBeGreaterThan(200);
      expect(member.source).toEqual({ id: member.id, updatedAt: 1000 });
      expect(member.candidates).toEqual([
        {
          id: "codex/codex:fixture",
          harness: "codex",
          model: "codex:fixture",
          modelSettings: { effort: "medium" },
          capabilities: {},
        },
      ]);
    }
    expect((await f.service.list(f.other.id)).definitions).toEqual(view.definitions);
    expect((await f.service.list(f.other.id)).agents).toEqual(view.agents);
    expect(view.runs).toEqual([]);
    expect(f.engine.command).not.toHaveBeenCalled();
    expect(f.tasks.tick).not.toHaveBeenCalled();
  });

  it("preserves existing projects, custom profiles and intervening saves during discovery", async () => {
    const f = await fixture();
    const initial = createDefaultCrew(catalog, 1)!;
    await f.service.save({
      ...initial.definition,
      id: "custom",
      projectId: f.project.id,
      name: "My team",
    });
    await f.service.call(
      "crews.agent.save",
      {
        agent: { ...initial.agents[0]!, id: "custom-lead", name: "My lead" },
      },
      f.project.id,
    );
    let resolve!: (value: HostModelCatalog) => void;
    f.models.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const listing = f.list();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const saved = (await f.service.list(f.project.id)).definitions.find(
      (definition) => definition.id === "custom",
    )!;
    await f.service.save({ ...saved, name: "Owner's latest team" }, saved.updatedAt);
    resolve(catalog);
    await listing;
    expect(
      (await f.service.list(f.project.id)).definitions.find(
        (definition) => definition.id === "custom",
      )?.name,
    ).toBe("Owner's latest team");
    expect(
      (await f.service.list(f.project.id)).agents.find((agent) => agent.id === "custom-lead")?.name,
    ).toBe("My lead");
    expect(
      (await f.service.list(f.other.id)).definitions.map((definition) => definition.id),
    ).toEqual([DEFAULT_CREW_ID]);
  });

  it("seeds once across concurrent project reads and host restarts", async () => {
    const f = await fixture();
    await Promise.all([f.list(), f.list(f.other.id), f.list()]);
    expect((await f.service.list(f.project.id)).definitions).toHaveLength(1);
    expect((await f.service.list(f.project.id)).agents).toHaveLength(17);
    const calls = f.models.mock.calls.length;
    await (await f.restart()).call("crews.list", {}, f.project.id);
    expect(f.models).toHaveBeenCalledTimes(calls);
    expect((await f.service.list(f.project.id)).agents).toHaveLength(17);
  });

  it("keeps owner edits and deletions permanently and leaves team snapshots independent", async () => {
    const f = await fixture();
    await f.list();
    const before = await f.service.list(f.project.id);
    const profile = before.agents.find((agent) => agent.name === "Mobile Engineer")!;
    await f.service.call(
      "crews.agent.save",
      {
        agent: { ...profile, name: "Our mobile expert", instructions: "Our own rules" },
        expectedUpdatedAt: profile.updatedAt,
      },
      f.project.id,
    );
    expect(
      (await f.service.list(f.project.id)).definitions[0]!.agents.find(
        (agent) => agent.id === profile.id,
      )?.instructions,
    ).toBe(profile.instructions);
    const team = before.definitions[0]!;
    await f.service.save({ ...team, name: "Our product team" }, team.updatedAt);
    const restarted = await f.restart();
    await restarted.call("crews.list", {}, f.other.id);
    expect((await restarted.list(f.other.id)).definitions[0]!.name).toBe("Our product team");
    expect(
      (await restarted.list(f.other.id)).agents.find((agent) => agent.id === profile.id),
    ).toMatchObject({ name: "Our mobile expert", instructions: "Our own rules" });
    const savedTeam = (await restarted.list(f.other.id)).definitions[0]!;
    await restarted.call(
      "crews.delete",
      { definitionId: savedTeam.id, expectedUpdatedAt: savedTeam.updatedAt },
      f.other.id,
    );
    await restarted.call("crews.agent.delete", { agentId: profile.id }, f.other.id);
    const again = await f.restart();
    await again.call("crews.list", {}, f.project.id);
    expect((await again.list(f.project.id)).definitions).toEqual([]);
    expect((await again.list(f.project.id)).agents.some((agent) => agent.id === profile.id)).toBe(
      false,
    );
    expect((await again.list(f.project.id)).agents).toHaveLength(16);
  });

  it("retries empty or failed catalogs without overwriting existing crews", async () => {
    const f = await fixture();
    f.models.mockRejectedValueOnce(new Error("Provider offline"));
    await f.list();
    f.models.mockResolvedValueOnce({ models: {}, errors: {} });
    await f.list();
    expect((await f.service.list(f.project.id)).definitions).toEqual([]);
    await f.list();
    expect((await f.service.list(f.project.id)).definitions).toHaveLength(1);
  });

  it("does not let conversation reads initialize global data or invalid projects trigger discovery", async () => {
    const f = await fixture();
    await f.service.call("crews.list", {}, f.project.id, {
      projectId: f.project.id,
      sessionId: "agent",
    });
    expect((await f.service.list(f.project.id)).definitions).toEqual([]);
    expect(f.models).not.toHaveBeenCalled();
    await expect(f.list("missing-project")).rejects.toThrow();
    expect(f.models).not.toHaveBeenCalled();
    await f.list();
    expect((await f.service.list(f.project.id)).definitions).toHaveLength(1);
  });

  it("upgrades untouched v1 instructions, adds data specialties and preserves active snapshots", async () => {
    const f = await fixture();
    const legacy = legacySeed();
    const oldRun = {
      id: "old-run",
      projectId: f.project.id,
      definition: structuredClone(legacy.definition),
      status: "active",
      assignments: [],
      messages: [],
      notifications: {},
      createdAt: 10,
      updatedAt: 10,
    };
    await persistLegacy(f.store, { ...legacy, runs: [oldRun] });
    await f.list();
    const view = await f.service.list(f.project.id);
    expect(view.agents).toHaveLength(17);
    expect(view.definitions[0]!.agents).toHaveLength(17);
    expect(
      view.agents.every((agent) => agent.instructions.includes("Technology and evidence")),
    ).toBe(true);
    for (const member of view.definitions[0]!.agents) {
      const profile = view.agents.find((agent) => agent.id === member.id)!;
      expect(member.instructions).toBe(profile.instructions);
      expect(member.source).toEqual({ id: profile.id, updatedAt: profile.updatedAt });
    }
    const stored = JSON.parse(
      String(
        (await f.store.db.prepare("SELECT value FROM metadata WHERE key=?").get("crews.v1"))!.value,
      ),
    );
    expect(stored.runs).toEqual([oldRun]);
    expect(stored.defaultsRevision).toBe(DEFAULT_CREW_REVISION);
    const calls = f.models.mock.calls.length;
    await (await f.restart()).call("crews.list", {}, f.project.id);
    expect(f.models).toHaveBeenCalledTimes(calls);
  });

  it("keeps owner instructions, model choices and pending profile changes on revision upgrade", async () => {
    const f = await fixture();
    const legacy = legacySeed();
    const mobile = legacy.agents.find((agent) => agent.name === "Mobile Engineer")!;
    mobile.instructions = "Owner's mobile rules";
    const ui = legacy.agents.find((agent) => agent.name === "UI Engineer")!;
    ui.name = "Our UI expert";
    ui.groups = ["Our group"];
    ui.candidates[0]!.modelSettings = { effort: "high" };
    ui.updatedAt = 99; // The team has not accepted this owner's library change.
    legacy.definition.name = "Our named team";
    legacy.definition.policy.maxParallel = 1;
    const teamMobile = legacy.definition.agents.find((member) => member.id === mobile.id)!;
    teamMobile.instructions = "Owner's separate team rules";
    const teamUI = legacy.definition.agents.find((member) => member.id === ui.id)!;
    const oldSource = structuredClone(teamUI.source);
    const custom = {
      ...structuredClone(legacy.definition),
      id: "custom-copy",
      projectId: f.project.id,
    };
    await persistLegacy(f.store, { ...legacy, definitions: [legacy.definition, custom] });
    await f.list();
    const view = await f.service.list(f.project.id);
    expect(view.agents.find((agent) => agent.id === mobile.id)?.instructions).toBe(
      "Owner's mobile rules",
    );
    expect(view.agents.find((agent) => agent.id === ui.id)).toMatchObject({
      name: "Our UI expert",
      groups: ["Our group"],
      candidates: [{ modelSettings: { effort: "high" } }],
    });
    const team = view.definitions.find((definition) => definition.id === DEFAULT_CREW_ID)!;
    expect(team).toMatchObject({ name: "Our named team", policy: { maxParallel: 1 } });
    expect(team.agents.find((member) => member.id === mobile.id)?.instructions).toBe(
      "Owner's separate team rules",
    );
    expect(team.agents.find((member) => member.id === ui.id)?.source).toEqual(oldSource);
    expect(view.definitions.find((definition) => definition.id === custom.id)).toEqual(custom);
  });

  it("never restores prior deletions or expands an owner-pruned example roster", async () => {
    const f = await fixture();
    const legacy = legacySeed();
    const removed = "bycoda.role.mobile-engineer";
    legacy.agents = legacy.agents.filter((agent) => agent.id !== removed);
    legacy.definition.agents = legacy.definition.agents.filter((agent) => agent.id !== removed);
    await persistLegacy(f.store, legacy);
    await f.list();
    const view = await f.service.list(f.project.id);
    expect(view.agents).toHaveLength(16);
    expect(view.agents.some((agent) => agent.id === removed)).toBe(false);
    expect(view.agents.some((agent) => agent.id === "bycoda.role.dba")).toBe(true);
    expect(view.definitions[0]!.agents).toHaveLength(14);
    expect(view.definitions[0]!.agents.some((member) => member.id === "bycoda.role.dba")).toBe(
      false,
    );
    const deleted = legacySeed();
    await persistLegacy(f.store, { ...deleted, agents: [], definitions: [] });
    await f.list();
    expect((await f.service.list(f.project.id)).definitions).toEqual([]);
    expect((await f.service.list(f.project.id)).agents.map((agent) => agent.id)).toEqual([
      "bycoda.role.dba",
      "bycoda.role.data-engineer",
    ]);
  });

  it("does not give global example members provenance from project-only reserved-ID collisions", async () => {
    const f = await fixture();
    const seed = createDefaultCrew(catalog, 1)!;
    const profile = seed.agents.find((agent) => agent.id === "bycoda.role.dba")!;
    await f.service.call(
      "crews.agent.save",
      {
        agent: { ...profile, projectId: f.project.id },
      },
      f.project.id,
    );
    await f.list();
    expect((await f.service.list(f.other.id)).agents.some((agent) => agent.id === profile.id)).toBe(
      false,
    );
    const member = (await f.service.list(f.other.id)).definitions[0]!.agents.find(
      (agent) => agent.id === profile.id,
    )!;
    expect(member.instructions).toBe(profile.instructions);
    expect(member.source).toBeUndefined();
    expect(
      (await f.service.list(f.project.id)).agents.find((agent) => agent.id === profile.id)
        ?.projectId,
    ).toBe(f.project.id);
  });
});
