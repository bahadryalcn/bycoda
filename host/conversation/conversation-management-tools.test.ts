import { describe, expect, it, vi } from "vitest";
import {
  ConversationManagementTools,
  MANAGEMENT_CONVERSATION_TOOLS,
  MANAGEMENT_READS,
  managementCommand,
  pageDesktopManagementSnapshot,
  type ManagementReceipt,
  type GlobalManagementPrincipal,
  type ManagementAction,
} from "./conversation-management-tools";
import { validateConversationTool, conversationToolCatalog } from "./conversation-tools";
import { voiceThreadToolAllowed } from "../../src/shared/model/voiceToolScope";

const principal = {
  kind: "assistant-thread" as const,
  projectId: "project",
  threadId: "thread",
  environmentId: "host",
};
function fixture() {
  const receipts = new Map<string, ManagementReceipt>();
  const execute = vi.fn(async () => ({ changed: true }));
  const approve = vi.fn(async (operation) => ({
    approved: true,
    operationHash: operation.operationHash,
  }));
  const ports = {
    execute,
    approve,
    receipt: async (key: string) => receipts.get(key),
    saveReceipt: async (key: string, value: ManagementReceipt) => {
      receipts.set(key, value);
    },
  };
  return { receipts, execute, approve, ports, tools: new ConversationManagementTools(ports) };
}
describe("management authority and uncertain delivery", () => {
  it("qualifies the canonical effect only after native review and holds it until settled", async () => {
    const f = fixture();
    const events: string[] = [];
    f.approve.mockImplementation(async operation => { events.push("review"); return { approved: true, operationHash: operation.operationHash }; });
    let finish!: () => void;
    f.execute.mockImplementation(async () => { events.push("effect"); await new Promise<void>(resolve => { finish = resolve; }); return { changed: true }; });
    const pending = f.tools.call("preferences.patch", { requestId: "qualified", expectedRevision: "rev", change: {} }, principal, async () => true, async effect => {
      events.push("capture");
      try { return await effect(); } finally { events.push("release"); }
    });
    await vi.waitFor(() => expect(events).toEqual(["review", "capture", "effect"]));
    finish();
    expect(await pending).toMatchObject({ state: "completed" });
    expect(events).toEqual(["review", "capture", "effect", "release"]);
  });

  it("keeps global thread receipts stable across restart and separate from project scope", async () => {
    const f = fixture();
    const global: GlobalManagementPrincipal = { kind: "assistant-thread", threadId: "thread", environmentId: "host" };
    const tools = new ConversationManagementTools<ManagementAction, GlobalManagementPrincipal>(f.ports);
    const input = { requestId: "same-id", expectedRevision: "rev", change: { kind: "theme", value: "dark" } };
    expect(await tools.call("preferences.patch", input, global, async () => true)).toMatchObject({ state: "completed" });
    expect(await new ConversationManagementTools<ManagementAction, GlobalManagementPrincipal>(f.ports).call("preferences.patch", input, global, async () => true)).toMatchObject({ state: "completed" });
    await f.tools.call("preferences.patch", input, principal, async () => true);
    expect(f.execute).toHaveBeenCalledTimes(2);
    await expect(tools.call("preferences.patch", { ...input, expectedRevision: "changed" }, global, async () => true)).rejects.toThrow("different input");
  });
  it("fails global writes if thread authority is revoked during approval", async () => {
    const f = fixture();
    const global: GlobalManagementPrincipal = { kind: "assistant-thread", threadId: "thread", environmentId: "host" };
    let valid = true;
    f.approve.mockImplementation(async (operation) => { valid = false; return { approved: true, operationHash: operation.operationHash }; });
    const result = await new ConversationManagementTools<ManagementAction, GlobalManagementPrincipal>(f.ports).call("preferences.patch", { requestId: "revoked", expectedRevision: "rev", change: {} }, global, async () => valid);
    expect(result).toMatchObject({ state: "failed" });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("retains an uncertain global receipt if authority is revoked while the effect returns", async () => {
    const f = fixture();
    const global: GlobalManagementPrincipal = { kind: "assistant-thread", threadId: "thread", environmentId: "host" };
    let valid = true;
    f.execute.mockImplementation(async () => { valid = false; return { changed: true }; });
    const tools = new ConversationManagementTools<ManagementAction, GlobalManagementPrincipal>(f.ports);
    const input = { requestId: "uncertain", expectedRevision: "rev", change: {} };
    expect(await tools.call("preferences.patch", input, global, async () => valid)).toMatchObject({ state: "uncertain" });
    valid = true;
    expect(await tools.call("preferences.patch", input, global, async () => valid)).toMatchObject({ state: "uncertain" });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects command paths that bypass accepted attachments or execution authority", () => {
    expect(
      managementCommand({ type: "cancel", sessionId: "session", runId: "run" }, "command"),
    ).toMatchObject({ type: "cancel", commandId: "command" });
    for (const command of [
      { type: "configure", sessionId: "session" },
      { type: "draft", sessionId: "session", attachments: [{ id: "foreign" }] },
      { type: "cancel", sessionId: "session", runId: "run", authorityGeneration: 1 },
      { type: "compact", sessionId: "session", queued: { id: "foreign" } },
      {
        type: "answer",
        sessionId: "session",
        runId: "run",
        requestId: 1,
        reply: { kind: "answered", answers: {}, attachments: { answer: [] } },
      },
    ])
      expect(() => managementCommand(command, "command")).toThrow();
  });
  it("keeps nested model and folder continuations reachable without discarding their parents", () => {
    const models = Array.from({ length: 45 }, (_, id) => ({ id }));
    expect(
      pageDesktopManagementSnapshot({ providers: [{ id: "codex", models }] }, { offset: 30 }),
    ).toMatchObject({
      providers: [
        { id: "codex", models: models.slice(30), modelPagination: { total: 45, nextOffset: null } },
      ],
    });
    const sessionIds = Array.from({ length: 45 }, (_, id) => `session-${id}`);
    expect(
      pageDesktopManagementSnapshot(
        { folders: [{ id: "folder", sessionIds }] },
        { memberOffset: 30 },
      ),
    ).toMatchObject({
      folders: [
        {
          id: "folder",
          sessionIds: sessionIds.slice(30),
          pagination: { sessionIds: { total: 45, nextOffset: null } },
        },
      ],
    });
  });
  it("rejects concurrent changed payloads sharing an in-flight identity", async () => {
    const f = fixture();
    let finish!: (value: { changed: boolean }) => void;
    f.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = f.tools.call(
      "git.commit",
      { requestId: "same", message: "first" },
      principal,
      async () => true,
    );
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    await expect(
      f.tools.call(
        "git.commit",
        { requestId: "same", message: "other" },
        principal,
        async () => true,
      ),
    ).rejects.toThrow("different input");
    finish({ changed: true });
    await first;
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("requires exact native approval hash, then retains result across retries", async () => {
    const f = fixture(),
      input = { requestId: "one", workspaceId: "w", expectedRevision: 2 };
    expect(
      await f.tools.call("workspaces.finish", input, principal, async () => true),
    ).toMatchObject({ state: "completed", result: { changed: true } });
    await new ConversationManagementTools(f.ports).call(
      "workspaces.finish",
      input,
      principal,
      async () => true,
    );
    expect(f.execute).toHaveBeenCalledTimes(1);
    await expect(
      f.tools.call("workspaces.close", input, principal, async () => true),
    ).rejects.toThrow("different input");
  });
  it("rejects declined or mismatched approval without effects", async () => {
    const f = fixture();
    f.approve.mockResolvedValue({ approved: true, operationHash: "other" });
    expect(
      await f.tools.call(
        "git.commit",
        { requestId: "one", message: "message" },
        principal,
        async () => true,
      ),
    ).toMatchObject({ state: "failed" });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("does not disclose a cached receipt after authority is revoked during its read", async () => {
    const f = fixture();
    const input = { requestId: "cached", message: "approved commit" };
    await f.tools.call("git.commit", input, principal, async () => true);
    const read = f.ports.receipt;
    let valid = true;
    f.ports.receipt = async (key) => {
      const value = await read(key);
      valid = false;
      return value;
    };
    await expect(f.tools.call("git.commit", input, principal, async () => valid))
      .rejects.toThrow("authority revoked");
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("keeps interrupted effects uncertain and never executes them again", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new Error("Transport lost"));
    const input = { requestId: "one", message: "message" };
    expect(await f.tools.call("git.commit", input, principal, async () => true)).toMatchObject({
      state: "uncertain",
    });
    expect(
      await new ConversationManagementTools(f.ports).call(
        "git.commit",
        input,
        principal,
        async () => true,
      ),
    ).toMatchObject({ state: "uncertain" });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("rechecks revoked authority after native review", async () => {
    const f = fixture();
    let valid = true;
    f.approve.mockImplementation(async (op) => {
      valid = false;
      return { approved: true, operationHash: op.operationHash };
    });
    expect(
      await f.tools.call("git.commit", { requestId: "one" }, principal, async () => valid),
    ).toMatchObject({ state: "failed" });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("exposes every registered operation with truthful read annotations and explicit scope", () => {
    const catalog = conversationToolCatalog();
    for (const action of Object.keys(MANAGEMENT_CONVERSATION_TOOLS)) {
      expect(catalog.find((tool) => tool.action === action)?.annotations.readOnlyHint).toBe(
        MANAGEMENT_READS.has(action),
      );
      expect(voiceThreadToolAllowed("conversation", action)).toBe(
        !action.startsWith("preferences.") &&
          !action.startsWith("providers.") &&
          action !== "history.import.status",
      );
    }
    expect(() =>
      validateConversationTool("preferences.patch", {
        requestId: "x",
        expectedRevision: "r",
        change: { kind: "theme", value: "dark" },
        approved: true,
      }),
    ).toThrow("protected");
    expect(() =>
      validateConversationTool("git.commit", { requestId: "x", message: "commit" }),
    ).toThrow("expectedStatus");
  });
});
