import { describe, expect, it, vi } from "vitest";
import { ConversationProjectTools, PROJECT_CONVERSATION_TOOLS } from "./conversation-project-tools";
import type { HostStore } from "./store";
import type { HostGoals } from "./goals";
import type { HostModelCatalog } from "../src/features/connections/model/protocol";
import { HostAutomations } from "./automations";

function setup() {
  const principal = {
    kind: "session" as const,
    sessionId: "self",
    projectId: "project",
    provider: "codex",
  };
  const store = {
    environmentId: "environment",
    usageMetadataPage: vi.fn(() => ({
      sessions: [],
      nextCursor: null,
      scannedSessions: 0,
      skippedSessions: 0,
    })),
    project: vi.fn(() => ({ id: "project", cwd: "root" })),
    session: vi.fn((id: string) => ({
      projectId: id === "foreign" ? "other" : "project",
      session: { cwd: "task-worktree" },
    })),
  } as unknown as Pick<HostStore, "project" | "session" | "usageMetadataPage" | "environmentId">;
  const goals = {
    list: vi.fn(() => [
      { id: "current", projectIds: ["project"], taskIds: ["task"], plan: { tasks: [] } },
      { id: "foreign", projectIds: ["other"], prompt: "private" },
      { id: "shared", projectIds: ["project", "other"], prompt: "private" },
    ]),
  } as unknown as Pick<HostGoals, "list">;
  const checkpoints = {
    status: vi.fn(async () => ({
      files: [{ relative: "a" }, { relative: "b" }],
      expectedCheckpoint: "token",
    })),
    fileDiff: vi.fn(async () => ({
      path: "task-worktree/a",
      relative: "a",
      original: "a".repeat(600),
      current: "b".repeat(100),
      binary: false,
      tooLarge: false,
      status: "modified",
      expectedCheckpoint: "token",
    })),
  };
  const models = vi.fn(async (): Promise<HostModelCatalog> => ({
    models: { codex: [{ id: "model", harness: "codex", name: "Model" }] },
    errors: { claude: "Discovery unavailable" },
    pending: ["claude"],
  }));
  const service = new ConversationProjectTools(
    store,
    goals,
    checkpoints as never,
    ["codex", "claude"],
    models,
    {
      stewards: {
        list: () => [
          {
            id: "steward",
            projectId: "project",
            focus: `token=${"private".repeat(40)}`,
            enabled: true,
            run: { sessionId: "run" },
          },
          { id: "foreign-steward", projectId: "other", focus: "foreign private focus" },
        ],
      } as never,
      automations: {
        preview: (input) =>
          HostAutomations.prototype.preview.call({ now: () => 0 } as never, input),
      },
    },
  );
  let authorized = true;
  const call = async (
    action: keyof typeof PROJECT_CONVERSATION_TOOLS,
    input: Record<string, unknown> = {},
  ) => await service.call(action, input, principal, () => authorized);
  return {
    call,
    checkpoints,
    models,
    revoke: () => {
      authorized = false;
    },
    service,
    principal,
    store,
  };
}

describe("project conversation reads", () => {
  it("reads steward summaries and bounded redacted detail without exposing other projects", async () => {
    const { call } = setup();
    const list = await call("stewards.list");
    expect(list).toMatchObject({
      total: 1,
      items: [{ id: "steward", enabled: true, running: true }],
    });
    expect(JSON.stringify(list)).not.toContain("focus");
    const detail = (await call("stewards.get", { stewardId: "steward", maxChars: 200 })) as {
      content: string;
      totalChars: number;
    };
    expect(detail.content.length).toBeLessThanOrEqual(200);
    expect(detail.content).not.toContain("private");
    expect(detail.content).toContain("[REDACTED]");
    await expect(call("stewards.get", { stewardId: "foreign-steward" })).rejects.toThrow(
      "project scope",
    );
  });

  it("previews schedules through the existing host validator without saving or starting runs", async () => {
    const { call } = setup();
    expect(await call("automations.preview", { scheduleKind: "hourly" })).toMatchObject({
      timeZone: expect.any(String),
      nextRunAt: expect.any(Number),
    });
    await expect(
      call("automations.preview", { scheduleKind: "daily", time: "25:61" }),
    ).rejects.toThrow("time");
  });

  it("binds usage to the grant's project and preserves unavailable billing information", async () => {
    const { call, store } = setup();
    const result = await call("usage.sessions.read", {
      sinceMs: 0,
      untilMs: 1000,
      projectId: "foreign",
    });
    expect(store.usageMetadataPage).toHaveBeenCalledWith("project", undefined, 50);
    expect(result).toMatchObject({
      projectId: "project",
      scope: "host-observed-sessions",
      totals: { cost: null },
      coverage: { unavailableFields: expect.arrayContaining(["accountQuota", "budget", "cost"]) },
    });
    await expect(
      call("usage.sessions.read", { sinceMs: 0, untilMs: 32 * 86400000 }),
    ).rejects.toThrow("window");
  });
  it("excludes other-project and multi-project goals rather than leaking their plan/prompt", async () => {
    const { call } = setup();
    expect(await call("goals.list")).toMatchObject({ total: 1, items: [{ id: "current" }] });
    const detail = (await call("goals.get", { goalId: "current" })) as { content: string };
    expect(JSON.parse(detail.content)).toMatchObject({ taskIds: ["task"] });
    await expect(call("goals.get", { goalId: "foreign" })).rejects.toThrow("project scope");
    await expect(call("goals.get", { goalId: "shared" })).rejects.toThrow("project scope");
  });

  it("binds checkpoints to the registered session worktree, rejects foreign sessions, and paginates", async () => {
    const { call, checkpoints } = setup();
    expect(await call("checkpoints.status", { limit: 1 })).toMatchObject({
      total: 2,
      nextOffset: 1,
      expectedCheckpoint: "token",
      items: [{ relative: "a" }],
    });
    expect(checkpoints.status).toHaveBeenCalledWith("self", "task-worktree");
    await expect(call("checkpoints.status", { sessionId: "foreign" })).rejects.toThrow(
      "project scope",
    );
    expect(checkpoints.status).toHaveBeenCalledTimes(1);
  });

  it("bounds both diff sides independently and retains checkpoint identity", async () => {
    const { call, checkpoints } = setup();
    const result = await call("checkpoints.diff", { relative: "a", offset: 50, maxChars: 200 });
    expect(result).toMatchObject({
      original: "a".repeat(200),
      current: "b".repeat(50),
      originalLength: 600,
      currentLength: 100,
      originalNextOffset: 250,
      currentNextOffset: null,
      expectedCheckpoint: "token",
    });
    expect(checkpoints.fileDiff).toHaveBeenCalledWith("self", "task-worktree", "a");
  });

  it("redacts complete credentials before slicing checkpoint pages", async () => {
    const { call, checkpoints } = setup();
    const secret = "credential-".repeat(40);
    checkpoints.fileDiff.mockResolvedValueOnce({
      path: "a",
      relative: "a",
      original: `token=${secret}\nend`,
      current: `Authorization: Bearer ${secret}\nend`,
      binary: false,
      tooLarge: false,
      status: "modified",
      expectedCheckpoint: "token",
    });
    const result = await call("checkpoints.diff", { relative: "a", offset: 10, maxChars: 200 });
    expect(JSON.stringify(result)).not.toContain("credential");
    expect(result).toMatchObject({ originalNextOffset: null, currentNextOffset: null });
  });

  it("reuses progressive catalog discovery and preserves partial/error state", async () => {
    const { call, models } = setup();
    expect(await call("providers.list")).toEqual({ providers: ["codex", "claude"] });
    expect(models).not.toHaveBeenCalled();
    expect(await call("models.list")).toMatchObject({
      total: 1,
      items: [{ provider: "codex", model: { id: "model" } }],
      errors: { claude: "Discovery unavailable" },
      pending: ["claude"],
    });
    expect(models).toHaveBeenCalledWith("project", true);
    expect(await call("models.list", { provider: "codex", offset: 1 })).toMatchObject({
      total: 1,
      items: [],
      nextOffset: null,
      errors: {},
      pending: [],
    });
  });

  it("refuses revoked grants before reads and after asynchronous discovery", async () => {
    const first = setup();
    first.revoke();
    await expect(first.call("goals.list")).rejects.toThrow("revoked");
    const second = setup();
    second.models.mockImplementationOnce(async () => {
      second.revoke();
      return { models: {}, errors: {} };
    });
    await expect(second.call("models.list")).rejects.toThrow("revoked");
  });

  it("fails closed for unknown actions even when called without the schema dispatcher", async () => {
    const { service, principal } = setup();
    await expect(
      service.call("checkpoints.undo" as never, {}, principal, () => true),
    ).rejects.toThrow("Unsupported");
  });
});
