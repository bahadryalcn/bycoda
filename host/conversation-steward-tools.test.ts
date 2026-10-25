import { describe, expect, it, vi } from "vitest";
import {
  ConversationStewardTools,
  type StewardConversationTool,
} from "./conversation-steward-tools";
import type { HostSteward } from "../src/features/tasks/model/hostStewards";
import type { Session } from "../src/features/sessions/model/session";
import type { HostTask } from "../src/features/tasks/model/hostTasks";

function setup() {
  const records: HostSteward[] = [];
  const proposals = new Map<string, HostTask>();
  const session = {
    harness: "codex",
    model: "test",
    modelSettings: { effort: "medium" },
    runtimeMode: "supervised",
  } as unknown as Session;
  const principal = {
    kind: "session" as const,
    projectId: "project",
    sessionId: "caller",
    provider: "codex",
  };
  const service = {
    list: () => records,
    save: vi.fn((raw: Record<string, unknown>) => {
      const value = {
        ...raw,
        updatedAt: Number(raw.updatedAt ?? 0) + 1,
        nextRunAt: 1000,
      } as unknown as HostSteward;
      const old = records.findIndex((item) => item.id === value.id);
      if (old >= 0) records[old] = value;
      else records.push(value);
      return value;
    }),
    runNow: vi.fn(async (id: string) => ({
      ...records.find((entry) => entry.id === id)!,
      run: { sessionId: "worker", runId: "turn", startedAt: 1 },
    })),
    stopRun: vi.fn((id: string, runId: string) => ({
      requested: true as const,
      run: records.find((item) => item.id === id)?.run ?? { runId, startedAt: 1 },
    })),
    delete: vi.fn(async (id: string) => {
      const at = records.findIndex((entry) => entry.id === id);
      if (at >= 0) records.splice(at, 1);
    }),
    decline: vi.fn(async (_taskId: string) => {}),
  };
  const tools = new ConversationStewardTools(
    { project: vi.fn(), transaction: (fn: () => unknown) => fn() } as never,
    service,
    { get: (id) => proposals.get(id) },
  );
  let authorized = true;
  const call = async (action: StewardConversationTool, input: Record<string, unknown>) =>
    await tools.call(action, input, principal, session, () => authorized);
  const create = async () =>
    await call("stewards.create", {
      stewardId: "steward",
      scheduleKind: "daily",
      focus: "token=private",
    });
  return {
    call,
    create,
    records,
    proposals,
    service,
    revoke: () => {
      authorized = false;
    },
  };
}

describe("steward conversation lifecycle", () => {
  it("deletes only settled stewards and declines only matching current proposals", async () => {
    const { create, call, records, proposals, service } = setup();
    await create();
    const input = { stewardId: "steward", expectedUpdatedAt: 1 };
    records[0].run = { runId: "active", sessionId: "worker", startedAt: 1 };
    await expect(call("stewards.delete", input)).rejects.toThrow("settlement");
    records[0].run = undefined;
    proposals.set("proposal", {
      id: "proposal",
      projectId: "other",
      stewardId: "steward",
      source: "steward",
      status: "todo",
      updatedAt: 2,
    } as HostTask);
    const decline = { ...input, taskId: "proposal", expectedTaskUpdatedAt: 2 };
    await expect(call("stewards.decline", decline)).rejects.toThrow("this project");
    proposals.get("proposal")!.projectId = "project";
    await expect(
      call("stewards.decline", { ...decline, expectedTaskUpdatedAt: 0 }),
    ).rejects.toThrow("changed");
    expect(await call("stewards.decline", decline)).toMatchObject({ declined: true });
    expect(service.decline).toHaveBeenCalledWith("proposal");
    expect(await call("stewards.delete", input)).toMatchObject({ deleted: true });
    expect(records).toHaveLength(0);
  });
  it("inherits execution identity and never auto-starts or auto-merges proposals", async () => {
    const { create, service } = setup();
    const result = await create();
    expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project",
        harness: "codex",
        model: "test",
        modelSettings: { effort: "medium" },
        runtimeMode: "supervised",
        autoStart: false,
        autoMerge: false,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("private");
    await expect(create()).rejects.toThrow("already exists");
  });

  it("checks scope, revision, self-management and protected settings", async () => {
    const { create, call, records } = setup();
    await create();
    await expect(
      call("stewards.update", { stewardId: "steward", expectedUpdatedAt: 0, focus: "new" }),
    ).rejects.toThrow("changed");
    await expect(
      call("stewards.update", { stewardId: "steward", expectedUpdatedAt: 1, autoMerge: true }),
    ).rejects.toThrow("protected");
    records[0].projectId = "other";
    await expect(
      call("stewards.pause", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("scope");
    records[0].projectId = "project";
    records[0].lastSessionId = "caller";
    await expect(
      call("stewards.pause", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("own steward");
  });

  it("updates scheduling and pauses/resumes without changing execution flags", async () => {
    const { create, call, records } = setup();
    await create();
    await call("stewards.update", { stewardId: "steward", expectedUpdatedAt: 1, focus: "new" });
    expect(records[0]).toMatchObject({
      focus: "new",
      autoStart: false,
      autoMerge: false,
      runtimeMode: "supervised",
      updatedAt: 2,
    });
    await call("stewards.pause", { stewardId: "steward", expectedUpdatedAt: 2 });
    expect(records[0].enabled).toBe(false);
    await call("stewards.resume", { stewardId: "steward", expectedUpdatedAt: 3 });
    expect(records[0].enabled).toBe(true);
  });

  it("prevents running/resuming configurations with broader execution permissions but permits pause", async () => {
    const { create, call, records, service } = setup();
    await create();
    records[0].autoStart = true;
    await expect(
      call("stewards.runNow", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("owner management");
    await expect(
      call("stewards.resume", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("owner management");
    records[0].autoStart = false;
    records[0].runtimeMode = "auto";
    await expect(
      call("stewards.runNow", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).rejects.toThrow("owner management");
    await call("stewards.pause", { stewardId: "steward", expectedUpdatedAt: 1 });
    expect(service.runNow).not.toHaveBeenCalled();
  });

  it("starts a run once while active and stops only through an explicit run identity", async () => {
    const { create, call, records, service } = setup();
    await create();
    expect(
      await call("stewards.runNow", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).toMatchObject({ requested: true, run: { runId: "turn" } });
    records[0].run = { runId: "turn", sessionId: "worker", startedAt: 1 };
    expect(
      await call("stewards.runNow", { stewardId: "steward", expectedUpdatedAt: 1 }),
    ).toMatchObject({ requested: false, reason: "already-running" });
    expect(service.runNow).toHaveBeenCalledTimes(1);
    expect(
      await call("stewards.stopRun", { stewardId: "steward", expectedUpdatedAt: 1, runId: "turn" }),
    ).toMatchObject({ requested: true });
    expect(service.stopRun).toHaveBeenCalledWith("steward", "turn");
  });

  it("denies revoked authority before mutation", async () => {
    const { create, revoke, service } = setup();
    revoke();
    await expect(create()).rejects.toThrow("revoked");
    expect(service.save).not.toHaveBeenCalled();
  });
});
