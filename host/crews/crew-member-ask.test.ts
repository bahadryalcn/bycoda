import { forEachAsync } from "../async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import {
  initializeCrewSchedulerProjection,
  readCrewState,
  writeCrewState,
} from "./crew-scheduler-projection";
import {
  askCrewMember,
  memberAskInput,
  memberAskTaskId,
  type CrewMemberAskPorts,
} from "./crew-member-ask";
import type { SavedCrewAgent, CrewCandidate } from "../../src/features/crews/model/crew";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import {
  CREW_MEMBER_KEY,
  DELEGATION_PARENT_KEY,
  decodeCrewMemberChild,
  decodeDelegationParent,
  providerModelSettings,
} from "../../src/shared/model/host-contracts/delegation";

const stores: HostStore[] = [];
afterEach(async () => {
  await forEachAsync(stores.splice(0), async (store) => await store.close());
});

const candidate = (id: string): CrewCandidate => ({
  id,
  harness: "codex",
  model: `model-${id}`,
  modelSettings: { effort: "low" },
  capabilities: {},
});
const member = (id: string, extra: Partial<SavedCrewAgent> = {}): SavedCrewAgent => ({
  id,
  name: `Name ${id}`,
  role: "specialist",
  instructions: `INSTRUCTIONS ${id}`,
  selection: "fixed",
  candidates: [candidate(`${id}-a`), candidate(`${id}-b`)],
  updatedAt: 1,
  ...extra,
});

async function setup(agents: SavedCrewAgent[]) {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject("/member-ask", "Fixture");
  const other = await store.addProject("/member-ask-other", "Other");
  await initializeCrewSchedulerProjection(store);
  const state = await readCrewState(store);
  await store.transaction(() => writeCrewState(store, { ...state, agents }));
  const rows = new Map<string, HostTask>();
  const saved: Array<Record<string, unknown>> = [];
  const candidateFor = vi.fn(async (definition: { agents: SavedCrewAgent[] }, memberId: string) => {
    const agent = definition.agents.find((a) => a.id === memberId)!;
    return { candidate: agent.candidates[0]!, reason: "test" };
  });
  const ports: CrewMemberAskPorts = {
    store,
    now: () => 500,
    candidate: candidateFor as unknown as CrewMemberAskPorts["candidate"],
    parentRuntimeMode: vi.fn(async (id: string) => {
      if (id === "foreign") throw new Error("Foreign coordinator session");
      return "auto-accept-edits" as const;
    }),
    tasks: {
      taskIndex: async (ids) => new Map([...rows].filter(([id]) => !ids || ids.includes(id))),
      save: vi.fn(async (input: unknown) => {
        const value = input as Record<string, unknown>;
        saved.push(value);
        const task = { ...value, createdAt: 1, updatedAt: 1 } as unknown as HostTask;
        rows.set(task.id, task);
        return task;
      }),
      tick: vi.fn(async () => {}),
    },
  };
  return { ports, project, other, saved, rows, candidateFor };
}
const ask = (f: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown> = {}) =>
  askCrewMember(f.ports, {
    projectId: f.project.id,
    requestId: "req-1",
    memberId: "dev",
    prompt: "Fix the login bug\nand add a test",
    ...extra,
  });

describe("askCrewMember", () => {
  it("queues a plain task with instructions, supervised mode and no review", async () => {
    const f = await setup([member("dev", { handle: "dev" })]);
    const result = await ask(f);
    expect(result).toMatchObject({
      memberId: "dev",
      memberName: "Name dev",
      handle: "dev",
      reused: false,
    });
    const task = f.saved[0]!;
    expect(task).toMatchObject({
      id: memberAskTaskId(f.project.id, "req-1"),
      projectId: f.project.id,
      title: "Fix the login bug",
      harness: "codex",
      model: "model-dev-a",
      runtimeMode: "supervised",
      review: false,
      status: "queued",
      expectedAbsent: true,
    });
    expect(task).not.toHaveProperty("crewRunId");
    expect(String(task.prompt)).toContain("INSTRUCTIONS dev");
    expect(String(task.prompt)).toContain("Fix the login bug\nand add a test");
    expect(f.ports.tasks.tick).toHaveBeenCalled();
  });

  it("resolves by handle, case-insensitively, preferring the project copy", async () => {
    const f = await setup([
      member("global-dev", { handle: "dev" }),
      member("proj-dev", { handle: "dev" }),
    ]);
    const state = await readCrewState(f.ports.store);
    await f.ports.store.transaction(() =>
      writeCrewState(f.ports.store, {
        ...state,
        agents: [
          member("global-dev", { handle: "dev" }),
          member("proj-dev", { handle: "dev", projectId: f.project.id }),
        ],
      }),
    );
    const result = await ask(f, { memberId: undefined, handle: "@DEV" });
    expect(result.memberId).toBe("proj-dev");
  });

  it("scopes members to the project and rejects unknown members", async () => {
    const f = await setup([member("secret", { projectId: "someone-else" })]);
    await expect(ask(f, { memberId: "secret" })).rejects.toThrow("not available");
    await expect(ask(f, { memberId: undefined, handle: "nobody" })).rejects.toThrow(
      "not available",
    );
    expect(f.saved).toHaveLength(0);
  });

  it("rejects a missing or double selector", async () => {
    const f = await setup([member("dev")]);
    await expect(ask(f, { memberId: undefined })).rejects.toThrow();
    await expect(ask(f, { handle: "dev" })).rejects.toThrow();
  });

  it("asks the existing selection for the member alone with the default policy", async () => {
    const f = await setup([member("dev")]);
    await ask(f);
    expect(f.candidateFor).toHaveBeenCalledTimes(1);
    const [definition, id] = f.candidateFor.mock.calls[0]!;
    expect(id).toBe("dev");
    expect(definition.agents.map((a) => a.id)).toEqual(["dev"]);
    expect((definition as unknown as { policy: { preset: string } }).policy.preset).toBe(
      "balanced",
    );
  });

  it("takes the runtime mode and delegation link from the parent session", async () => {
    const f = await setup([
      member("dev", {
        handle: "dev",
        avatar: { glasses: true },
        source: { id: "lib", updatedAt: 1 },
      }),
    ]);
    await ask(f, { parentSessionId: "parent-1", files: ["src/auth"] });
    const task = f.saved[0]!;
    expect(task.runtimeMode).toBe("auto-accept-edits");
    expect(task.crewScopes).toEqual(["src/auth"]);
    const settings = task.modelSettings as Record<string, string>;
    expect(settings.effort).toBe("low");
    expect(decodeDelegationParent(settings[DELEGATION_PARENT_KEY])).toMatchObject({
      parentSessionId: "parent-1",
      kind: "subagent",
      model: "model-dev-a",
      startedAt: 500,
    });
    expect(decodeCrewMemberChild(settings[CREW_MEMBER_KEY])).toMatchObject({
      id: "dev",
      name: "Name dev",
      handle: "dev",
      avatar: { glasses: true },
      sourceId: "lib",
    });
    // Providers never see either key.
    expect(Object.keys(providerModelSettings(settings))).toEqual(["effort"]);
  });

  it("does not link a delegation parent without a parent session", async () => {
    const f = await setup([member("dev")]);
    await ask(f);
    const settings = f.saved[0]!.modelSettings as Record<string, string>;
    expect(settings).not.toHaveProperty(DELEGATION_PARENT_KEY);
    expect(settings).toHaveProperty(CREW_MEMBER_KEY);
  });

  it("rejects a foreign parent session before creating a task", async () => {
    const f = await setup([member("dev")]);
    await expect(ask(f, { parentSessionId: "foreign" })).rejects.toThrow("Foreign");
    expect(f.saved).toHaveLength(0);
  });

  it("is idempotent per request ID and rejects a different payload", async () => {
    const f = await setup([member("dev")]);
    const first = await ask(f);
    const again = await ask(f);
    expect(again).toMatchObject({ taskId: first.taskId, reused: true });
    expect(f.saved).toHaveLength(1);
    await expect(ask(f, { prompt: "Something else" })).rejects.toThrow("different input");
    await expect(ask(f, { parentSessionId: "parent-2" })).rejects.toThrow("different input");
  });

  it("returns the existing task when a concurrent identical request wins the race", async () => {
    const f = await setup([member("dev")]);
    const save = f.ports.tasks.save;
    f.ports.tasks.save = vi.fn(async (input) => {
      await save(input);
      throw new Error("Task ID already exists. Choose a new ID.");
    });
    expect(await ask(f)).toMatchObject({ reused: true });
  });

  it("keeps request IDs separate per project", async () => {
    const f = await setup([member("dev")]);
    const a = await ask(f);
    const b = await askCrewMember(f.ports, {
      projectId: f.other.id,
      requestId: "req-1",
      memberId: "dev",
      prompt: "Fix the login bug\nand add a test",
    });
    expect(b.taskId).not.toBe(a.taskId);
  });

  it("binds a conversation ask to the caller's project and session", async () => {
    const principal = { projectId: "p1", sessionId: "caller" };
    expect(memberAskInput({ requestId: "r", prompt: "x" }, "p1", principal)).toEqual({
      requestId: "r",
      prompt: "x",
      projectId: "p1",
      parentSessionId: "caller",
    });
    expect(memberAskInput({ parentSessionId: "caller" }, "p1", principal)).toMatchObject({
      parentSessionId: "caller",
    });
    expect(() => memberAskInput({ parentSessionId: "someone-else" }, "p1", principal)).toThrow(
      "calling conversation",
    );
    const f = await setup([member("dev")]);
    const result = await askCrewMember(
      f.ports,
      memberAskInput({ requestId: "c1", memberId: "dev", prompt: "Do it" }, f.project.id, {
        projectId: f.project.id,
        sessionId: "caller",
      }),
    );
    const settings = f.saved[0]!.modelSettings as Record<string, string>;
    expect(decodeDelegationParent(settings[DELEGATION_PARENT_KEY])?.parentSessionId).toBe("caller");
    expect(f.saved[0]).toMatchObject({ runtimeMode: "auto-accept-edits" });
    expect(f.ports.parentRuntimeMode).toHaveBeenCalledWith("caller");
    expect(result.reused).toBe(false);
  });

  it("strips review transport fields and leaves owner input untouched", () => {
    expect(
      memberAskInput({ operationId: "o", expectedRevision: "e", requestId: "r" }, "p1"),
    ).toEqual({ requestId: "r", projectId: "p1" });
  });

  it("refuses a parent session of another project", async () => {
    const f = await setup([member("dev")]);
    await expect(ask(f, { parentSessionId: "foreign" })).rejects.toThrow("Foreign coordinator");
    expect(f.saved).toHaveLength(0);
  });

  it("rejects unsafe file scopes and oversized prompts", async () => {
    const f = await setup([member("dev")]);
    await expect(ask(f, { files: ["../outside"] })).rejects.toThrow();
    await expect(ask(f, { prompt: "x".repeat(20_001) })).rejects.toThrow();
  });
});
