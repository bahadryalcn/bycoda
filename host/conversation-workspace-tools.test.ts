import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostNotes } from "./host-notes";
import { HostAutomations } from "./automations";
import { ProviderInboxBridge } from "./provider-inbox";
import { ConversationWorkspaceTools } from "./conversation-workspace-tools";
import { validateConversationTool, type ConversationTool } from "./conversation-tools";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-workspace-tools-"));
  const store = new HostStore(join(directory, "host.db"));
  let finishRun = () => {};
  const engine = new HostEngine(store, {
    codex: {
      send: () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
      stop: async () => finishRun(),
      cancel: async () => finishRun(),
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const other = await store.addProject(join(directory, "other"), "Other");
  const created = await engine.command({
    type: "create",
    commandId: crypto.randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "test-model",
    runtimeMode: "supervised",
  });
  const principal = {
    kind: "session" as const,
    projectId: project.id,
    sessionId: created.sessionId,
    provider: "codex",
  };
  const noteFile = join(directory, "desktop.db");
  const db = new DatabaseSync(noteFile);
  db.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
  );
  db.close();
  const notes = new HostNotes(
    () => [noteFile],
    () => 1000,
  );
  const automations = new HostAutomations(store, engine, () => 1000);
  const inbox = new ProviderInboxBridge(store.db);
  const approval = vi.fn(async (_operation: Record<string, unknown>) => ({ approved: true }));
  const attention = vi.fn(async (_projectId: string) => [{ id: "attention" }]);
  const service = new ConversationWorkspaceTools(
    store,
    notes,
    automations,
    inbox,
    attention,
    approval,
  );
  let authorized = true;
  const call = async (action: ConversationTool, input: Record<string, unknown> = {}) => {
    validateConversationTool(action, input);
    return await service.call(
      action,
      input,
      principal,
      (await store.session(created.sessionId)).session,
      () => authorized,
    );
  };
  cleanup.push(async () => {
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return {
    call,
    service,
    principal,
    created,
    project,
    other,
    notes,
    automations,
    inbox,
    store,
    engine,
    approval,
    attention,
    revoke: () => {
      authorized = false;
    },
  };
}
const automation = {
  automationId: "daily",
  name: "Daily review",
  prompt: "Inspect the project",
  scheduleKind: "daily",
  time: "09:30",
  enabled: false,
};
const item = { provider: "github", kind: "pr", number: 7, repo: "owner/project" };

describe("direct application workspace tools", () => {
  it("creates, reads, edits and deletes project notes with atomic scope and stale edit protection", async () => {
    const s = await setup();
    const note: any = await s.call("notes.create", {
      id: "note",
      title: "Plan",
      body: "Markdown",
      tags: ["work"],
    });
    expect(note).toMatchObject({
      sourceCwd: s.project.cwd,
      sourceSessionId: s.principal.sessionId,
    });
    const updated: any = await s.call("notes.update", {
      id: "note",
      expectedUpdatedAt: note.updatedAt,
      body: "Changed",
    });
    expect(updated.title).toBe("Plan");
    expect(updated.tags).toEqual(["work"]);
    await expect(
      s.call("notes.update", { id: "note", expectedUpdatedAt: note.updatedAt, body: "Stale" }),
    ).rejects.toThrow("changed");
    const foreign = s.notes.save(
      { id: "foreign", title: "Other", body: "private", tags: [], sourceCwd: s.other.cwd },
      0,
    );
    await expect(s.call("notes.read", { id: foreign.id })).rejects.toThrow("another project");
    expect(() => s.notes.delete(foreign.id, foreign.updatedAt, s.project.cwd)).toThrow(
      "another project",
    );
    expect(() =>
      s.notes.save({ ...foreign, sourceCwd: s.project.cwd }, foreign.updatedAt, s.project.cwd),
    ).toThrow("another project");
    expect(((await s.call("notes.list")) as any).items.map((entry: any) => entry.id)).toEqual([
      "note",
    ]);
    await expect(s.call("notes.create", { id: "note", body: "duplicate" })).rejects.toThrow(
      "already exists",
    );
    await s.call("notes.delete", { id: "note", expectedUpdatedAt: updated.updatedAt });
    expect(s.notes.get("note")).toBeNull();
  });
  it("manages automations using the session's permission mode, scheduler and version controls", async () => {
    const s = await setup();
    const saved: any = await s.call("automations.create", automation);
    expect(saved).toMatchObject({
      projectId: s.project.id,
      runtimeMode: "supervised",
      model: "test-model",
      harness: "codex",
      enabled: false,
      time: "09:30",
    });
    const resumed: any = await s.call("automations.resume", {
      automationId: "daily",
      expectedUpdatedAt: saved.updatedAt,
    });
    expect(resumed.enabled).toBe(true);
    expect(resumed.updatedAt).toBeGreaterThan(saved.updatedAt);
    await expect(
      s.call("automations.pause", { automationId: "daily", expectedUpdatedAt: saved.updatedAt }),
    ).rejects.toThrow("changed");
    const paused: any = await s.call("automations.pause", {
      automationId: "daily",
      expectedUpdatedAt: resumed.updatedAt,
    });
    const changed: any = await s.call("automations.update", {
      automationId: "daily",
      expectedUpdatedAt: paused.updatedAt,
      prompt: "New instructions",
    });
    expect(changed.time).toBe("09:30");
    expect(changed.prompt).toBe("New instructions");
    await s.automations.save({ ...saved, id: "foreign", projectId: s.other.id });
    await expect(s.call("automations.runNow", { automationId: "foreign" })).rejects.toThrow(
      "another project",
    );
    expect(((await s.call("automations.list")) as any).items.map((entry: any) => entry.id)).toEqual(
      ["daily"],
    );
    const start = vi.spyOn(s.automations, "runNow").mockReturnValue({
      id: "run",
      automationId: "daily",
      trigger: "manual",
      status: "running",
      createdAt: 1000,
      scheduledFor: 1000,
    });
    expect(((await s.call("automations.runNow", { automationId: "daily" })) as any).status).toBe(
      "running",
    );
    start.mockRestore();
    await s.call("automations.delete", {
      automationId: "daily",
      expectedUpdatedAt: changed.updatedAt,
    });
    await expect(s.call("automations.get", { automationId: "daily" })).rejects.toThrow("not found");
  });
  it("lists attention Inbox and scopes native provider discovery, details and durable receipts", async () => {
    const s = await setup();
    expect(((await s.call("inbox.list")) as any).items).toEqual([{ id: "attention" }]);
    expect(s.attention).toHaveBeenCalledWith(s.project.id, s.principal);
    await expect(s.call("inbox.providers.list", { requestId: "offline" })).rejects.toThrow(
      "Open the updated",
    );
    await s.inbox.beat("native", "desktop", { version: 1 });
    const queued: any = await s.call("inbox.providers.list", { requestId: "list", state: "open" });
    expect(queued.state).toBe("queued");
    const jobs = (await s.inbox.beat("native", "desktop", { version: 1 })).jobs;
    expect(jobs[0].operation).toMatchObject({
      action: "list",
      projects: [{ path: s.project.cwd }],
    });
    await s.inbox.beat("native", "desktop", {
      version: 1,
      replies: [
        { id: queued.id, result: { items: [{ ...item, projectPath: s.project.cwd }], errors: {} } },
      ],
    });
    expect(((await s.call("inbox.result", { requestId: "list" })) as any).state).toBe("completed");
    await expect(
      s.call("inbox.details", { requestId: "foreign", item: { ...item, number: 99 } }),
    ).rejects.toThrow("Discover");
    expect(((await s.call("inbox.details", { requestId: "details", item })) as any).state).toBe(
      "queued",
    );
    expect(s.approval).not.toHaveBeenCalled();
    await expect(s.call("inbox.result", { requestId: "other-session" })).rejects.toThrow(
      "not found",
    );
  });
  it("exposes run history and cancellation while preventing an automation from controlling itself", async () => {
    const s = await setup();
    await s.call("automations.create", automation);
    const run = await s.automations.runNow("daily");
    expect(((await s.call("automations.runs", { automationId: "daily" })) as any).items[0].id).toBe(
      run.id,
    );
    const ownPrincipal = { ...s.principal, sessionId: run.sessionId! };
    await expect(
      s.service.call(
        "automations.runNow",
        { automationId: "daily" },
        ownPrincipal,
        (await s.store.session(run.sessionId!)).session,
        () => true,
      ),
    ).rejects.toThrow("own automation");
    expect(
      await s.call("automations.stopRun", { automationId: "daily", runId: run.id }),
    ).toMatchObject({ requested: true, run: { id: run.id } });
    await expect(
      s.call("automations.stopRun", { automationId: "daily", runId: "foreign" }),
    ).rejects.toThrow("not running");
  });
  it("requires exact owner approval, refuses revoked authority and never replays approved provider writes", async () => {
    const s = await setup();
    await s.inbox.beat("native", "desktop", { version: 1 });
    const listed: any = await s.call("inbox.providers.list", { requestId: "list" });
    await s.inbox.beat("native", "desktop", { version: 1 });
    await s.inbox.beat("native", "desktop", {
      version: 1,
      replies: [{ id: listed.id, result: { items: [{ ...item, projectPath: s.project.cwd }] } }],
    });
    const input = { requestId: "send", item, body: "Exact comment" };
    s.approval.mockResolvedValueOnce({ approved: false });
    await expect(s.call("inbox.comment", input)).rejects.toThrow("declined");
    const first: any = await s.call("inbox.comment", input);
    expect(s.approval).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "comment", body: "Exact comment", cwd: s.project.cwd }),
      s.project.cwd,
      s.principal,
      expect.any(Function),
    );
    expect(await s.call("inbox.comment", input)).toEqual(first);
    expect(s.approval).toHaveBeenCalledTimes(2);
    await expect(s.call("inbox.comment", { ...input, body: "Different comment" })).rejects.toThrow(
      "another operation",
    );
    s.approval.mockImplementationOnce(async () => {
      s.revoke();
      return { approved: true };
    });
    await expect(
      s.call("inbox.prAction", {
        requestId: "merge",
        item,
        prAction: "merge",
        expectedHeadOid: "a".repeat(40),
      }),
    ).rejects.toThrow("revoked");
  });
  it.each(["merge", "squash", "rebase"])(
    "keeps the reviewed head immutable while %s approval is pending",
    async (prAction) => {
      const s = await setup();
      await s.inbox.beat("native", "desktop", { version: 1 });
      const listed: any = await s.call("inbox.providers.list", { requestId: "list-head" });
      await s.inbox.beat("native", "desktop", { version: 1 });
      await s.inbox.beat("native", "desktop", {
        version: 1,
        replies: [{ id: listed.id, result: { items: [{ ...item, projectPath: s.project.cwd }] } }],
      });
      let approve!: (value: { approved: boolean }) => void;
      s.approval.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            approve = resolve;
          }),
      );
      const input = { requestId: "merge-head", item, prAction, expectedHeadOid: "a".repeat(40) };
      const pending = s.call("inbox.prAction", input);
      await vi.waitFor(() => expect(s.approval).toHaveBeenCalled());
      expect(s.approval.mock.calls[0][0]).toMatchObject({
        expectedHeadOid: "a".repeat(40),
        prAction,
      });
      await expect(
        s.call("inbox.prAction", { ...input, expectedHeadOid: "b".repeat(40) }),
      ).rejects.toThrow("another pending operation");
      approve({ approved: true });
      await pending;
      const jobs = await s.inbox.beat("native", "desktop", { version: 1 });
      expect(JSON.stringify(jobs)).toContain("a".repeat(40));
      expect(JSON.stringify(jobs)).not.toContain("b".repeat(40));
    },
  );
  it("requires exact approval for inline reviews and deduplicates the entire batch", async () => {
    const s = await setup();
    await s.inbox.beat("native", "desktop", { version: 1 });
    const listed: any = await s.call("inbox.providers.list", { requestId: "list-review" });
    await s.inbox.beat("native", "desktop", { version: 1 });
    await s.inbox.beat("native", "desktop", {
      version: 1,
      replies: [{ id: listed.id, result: { items: [{ ...item, projectPath: s.project.cwd }] } }],
    });
    const context: any = await s.call("inbox.reviewContext", { requestId: "context", item });
    expect(s.approval).not.toHaveBeenCalled();
    expect((await s.inbox.beat("native", "desktop", { version: 1 })).jobs).toContainEqual(
      expect.objectContaining({
        id: context.id,
        operation: expect.objectContaining({ action: "review-context" }),
      }),
    );
    const input = {
      requestId: "review",
      item,
      commitId: "a".repeat(40),
      event: "REQUEST_CHANGES",
      body: "Şu noktaya bakalım.",
      comments: [{ path: "src/a.ts", line: 9, side: "RIGHT", body: "Yetki kontrolü eksik." }],
    };
    s.approval.mockResolvedValueOnce({ approved: false });
    await expect(s.call("inbox.review", input)).rejects.toThrow("declined");
    const first: any = await s.call("inbox.review", input);
    expect(s.approval).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "review",
        commitId: input.commitId,
        event: input.event,
        body: input.body,
        comments: input.comments,
      }),
      s.project.cwd,
      s.principal,
      expect.any(Function),
    );
    expect(await s.call("inbox.review", input)).toEqual(first);
    expect(s.approval).toHaveBeenCalledTimes(2);
    const dispatched = await s.inbox.beat("native", "desktop", {
      version: 1,
      replies: [
        { id: context.id, result: { commitId: input.commitId, patch: "diff", truncated: false } },
      ],
    });
    expect(dispatched.jobs).toContainEqual(
      expect.objectContaining({
        id: first.id,
        operation: expect.objectContaining({ action: "review", comments: input.comments }),
      }),
    );
    await s.inbox.beat("native", "desktop", {
      version: 1,
      replies: [{ id: first.id, error: "Response lost after submission" }],
    });
    expect(await s.call("inbox.review", input)).toMatchObject({ id: first.id, state: "uncertain" });
    expect((await s.inbox.beat("native", "desktop", { version: 1 })).jobs).toEqual([]);
    expect(s.approval).toHaveBeenCalledTimes(2);
    await expect(
      s.call("inbox.review", { ...input, comments: [{ ...input.comments[0], line: 10 }] }),
    ).rejects.toThrow("another operation");
    await expect(
      s.call("inbox.review", { ...input, requestId: "unknown", item: { ...item, number: 999 } }),
    ).rejects.toThrow("Discover");
    s.approval.mockImplementationOnce(async () => {
      s.revoke();
      return { approved: true };
    });
    await expect(s.call("inbox.review", { ...input, requestId: "revoked-review" })).rejects.toThrow(
      "revoked",
    );
  });
  it("rejects forged identities, consent flags, invalid booleans and automation permission escalation", () => {
    for (const [action, input] of [
      ["notes.create", { id: "n", body: "test", sourceCwd: "/foreign" }],
      ["automations.create", { ...automation, runtimeMode: "full-access" }],
      ["automations.update", { automationId: "a", expectedUpdatedAt: 1, enabled: "true" }],
      ["inbox.comment", { requestId: "r", item, body: "comment", confirm: "SEND_COMMENT" }],
      ["inbox.details", { requestId: "r", item: { ...item, projectPath: "/other" } }],
    ] as const)
      expect(() => validateConversationTool(action, input)).toThrow();
  });
});
