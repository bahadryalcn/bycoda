import { expect, it, vi } from "vitest";
import { StoreDatabase } from "../store-db";
import { SessionQueues } from "../sessions/session-queue";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import type { QueuedMessage } from "../../src/features/sessions/model/session";
import { dispatchSessionControl } from "./conversation-session-control";
import { conversationToolCatalog, sessionConversationToolCatalog } from "./conversation-tools";
import type { SessionControlPorts } from "./conversation-session-control";
import {
  ConversationManagementTools,
  type ManagementReceipt,
} from "./conversation-management-tools";

function setup() {
  const target = {
    projectId: "project",
    revision: 4,
    authorityGeneration: 2,
    status: "running",
    runId: "run-1",
    session: {
      id: "target",
      title: "Target",
      harness: "codex",
      model: "codex:default",
      modelSettings: {},
      blocks: [{ id: "draft", draft: true, role: "user", text: "unfinished" }],
    },
  } as unknown as HostSession;
  const sender = {
    ...target,
    session: { ...target.session, id: "sender", title: "Source conversation" },
  };
  const before = {
    revision: 3,
    status: "paused" as const,
    editingId: "old",
    messages: [{ id: "old", text: "owner draft", attachments: [] }],
    drain: { holder: "desktop", epoch: 1, expiresAt: 123_456 },
  };
  const ports = {
    session: vi.fn(async (id: string) => (id === "sender" ? sender : target)),
    queues: {
      get: vi.fn<SessionControlPorts["queues"]["get"]>(async () => before),
      change: vi.fn<SessionControlPorts["queues"]["change"]>(async () => before),
    },
    owned: vi.fn(async () => false),
    cancel: vi.fn<SessionControlPorts["cancel"]>(async (_target, _id, check) => {
      await check();
      return { state: "accepted" };
    }),
  };
  const principal: RuntimeLogSubjectPrincipal = {
    kind: "session",
    sessionId: "sender",
    projectId: "project",
    provider: "codex",
  };
  const authorized = vi.fn(async () => true);
  const input = {
    requestId: "request",
    sessionId: "target",
    expectedRevision: 4,
    text: "Please check the API",
  };
  return { target, sender, before, ports, principal, authorized, input };
}

it("exposes finite control tools to both Room and coding sessions, as writes", () => {
  for (const catalog of [conversationToolCatalog(), sessionConversationToolCatalog()])
    for (const action of ["sessions.message", "sessions.cancel"])
      expect(catalog.find((tool) => tool.action === action)?.annotations?.readOnlyHint).toBe(false);
});

it("requires exact owner approval and never repeats an uncertain message", async () => {
  const f = setup();
  const receipts = new Map<string, ManagementReceipt>();
  let approve = false;
  const execute = vi.fn(async () => {
    await dispatchSessionControl("sessions.message", f.input, f.principal, f.authorized, f.ports);
    throw new Error("Acknowledgement lost");
  });
  const tools = new ConversationManagementTools({
    receipt: async (key) => receipts.get(key),
    saveReceipt: async (key, value) => {
      receipts.set(key, value);
    },
    approve: async (operation) => ({ approved: approve, operationHash: operation.operationHash }),
    execute,
  });
  expect(await tools.call("sessions.message", f.input, f.principal, f.authorized)).toMatchObject({
    state: "failed",
  });
  expect(execute).not.toHaveBeenCalled();
  approve = true;
  const input = { ...f.input, requestId: "approved" };
  expect(await tools.call("sessions.message", input, f.principal, f.authorized)).toMatchObject({
    state: "uncertain",
  });
  expect(await tools.call("sessions.message", input, f.principal, f.authorized)).toMatchObject({
    state: "uncertain",
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(f.ports.queues.change).toHaveBeenCalledOnce();
});

it.each(["session", "assistant-thread"] as const)(
  "queues %s messages without changing owner drafts, pause, editing or lease",
  async (kind) => {
    const f = setup();
    const principal =
      kind === "session"
        ? f.principal
        : ({
            kind,
            threadId: "room",
            projectId: "project",
            provider: "assistant",
          } as RuntimeLogSubjectPrincipal);
    const result = await dispatchSessionControl(
      "sessions.message",
      f.input,
      principal,
      f.authorized,
      f.ports,
    );
    expect(result).toMatchObject({ state: "queued", sessionId: "target" });
    const next = f.ports.queues.change.mock.calls[0]![2] as { messages: QueuedMessage[] };
    expect(next).toMatchObject({ status: "paused", editingId: "old", drain: f.before.drain });
    expect(next.messages[0]).toEqual(f.before.messages[0]);
    expect(next.messages[1]).toMatchObject({
      text: f.input.text,
      authorityGeneration: 2,
      author: { kind: kind === "session" ? "conversation" : "assistant-room" },
    });
    expect(f.target.session.blocks[0]!.text).toBe("unfinished");
    expect(f.ports.cancel).not.toHaveBeenCalled();
  },
);

it.each(["revoked", "project", "revision", "managed", "self", "owned", "blank"])(
  "refuses %s message admission before queue mutation",
  async (reason) => {
    const f = setup();
    if (reason === "revoked") f.authorized.mockResolvedValue(false);
    if (reason === "project") f.target.projectId = "other";
    if (reason === "revision") f.target.revision++;
    if (reason === "managed") f.target.managedBy = { assistant: true, jobId: "job", managedAt: 1 };
    if (reason === "self") f.input.sessionId = "sender";
    if (reason === "owned") f.ports.owned.mockResolvedValue(true);
    if (reason === "blank") f.input.text = "   ";
    await expect(
      dispatchSessionControl("sessions.message", f.input, f.principal, f.authorized, f.ports),
    ).rejects.toThrow();
    expect(f.ports.queues.change).not.toHaveBeenCalled();
  },
);

it("rechecks authority after queue reads and preserves existing rows on revocation", async () => {
  const f = setup();
  f.ports.queues.get.mockImplementation(async () => {
    f.authorized.mockResolvedValue(false);
    return f.before;
  });
  await expect(
    dispatchSessionControl("sessions.message", f.input, f.principal, f.authorized, f.ports),
  ).rejects.toThrow("revoked");
  expect(f.ports.queues.change).not.toHaveBeenCalled();
});

it("persists approved sender provenance in the real shared queue without taking its lease", async () => {
  const f = setup();
  const database = new StoreDatabase(":memory:");
  const queues = new SessionQueues(database);
  try {
    const before = await queues.change(
      "target",
      { messages: [] },
      {
        status: "paused",
        messages: [{ id: "owner", text: "unsent owner message", attachments: [] }],
      },
      "desktop:owner",
    );
    const result = await dispatchSessionControl(
      "sessions.message",
      f.input,
      f.principal,
      f.authorized,
      { ...f.ports, queues },
    );
    const after = await queues.get("target");
    expect(after.status).toBe("paused");
    expect(after.drain).toEqual(before.drain);
    expect(after.messages).toHaveLength(2);
    expect(result).toMatchObject({ messageId: after.messages[1]!.id });
    expect(after.messages[1]).toMatchObject({
      text: f.input.text,
      author: { kind: "conversation", id: "sender", name: "Source conversation" },
    });
  } finally {
    await database.close();
  }
});

it("cancels only the reviewed run and rechecks at command admission", async () => {
  const f = setup();
  const input = { requestId: "stop", sessionId: "target", runId: "run-1" };
  await expect(
    dispatchSessionControl("sessions.cancel", input, f.principal, f.authorized, f.ports),
  ).resolves.toEqual({ state: "accepted" });
  expect(f.ports.cancel).toHaveBeenCalledOnce();
  f.target.runId = "run-2";
  await expect(
    dispatchSessionControl("sessions.cancel", input, f.principal, f.authorized, f.ports),
  ).rejects.toThrow("run changed");
  expect(f.ports.cancel).toHaveBeenCalledOnce();
  expect(f.ports.queues.change).not.toHaveBeenCalled();
});

it("allows streaming revision changes while stopping the same reviewed run", async () => {
  const f = setup();
  f.ports.cancel.mockImplementation(async (_target, _id, check) => {
    f.target.revision++;
    await check();
    return { state: "accepted" };
  });
  await expect(
    dispatchSessionControl(
      "sessions.cancel",
      { requestId: "stop", sessionId: "target", runId: "run-1" },
      f.principal,
      f.authorized,
      f.ports,
    ),
  ).resolves.toEqual({ state: "accepted" });
});

it("keeps an identifiable sender when its Unicode title exceeds the provenance limit", async () => {
  const f = setup();
  f.sender.session.title = "👨‍👩‍👧‍👦".repeat(200);
  await dispatchSessionControl("sessions.message", f.input, f.principal, f.authorized, f.ports);
  const next = f.ports.queues.change.mock.calls[0]![2] as { messages: QueuedMessage[] };
  expect(next.messages[1]!.author).toMatchObject({ kind: "conversation", name: "sender" });
});

it("rejects a replacement run after review before the cancel effect", async () => {
  const f = setup();
  f.ports.cancel.mockImplementation(async (_target, _id, check) => {
    f.target.runId = "replacement";
    await check();
    return {};
  });
  await expect(
    dispatchSessionControl(
      "sessions.cancel",
      { requestId: "stop", sessionId: "target", runId: "run-1" },
      f.principal,
      f.authorized,
      f.ports,
    ),
  ).rejects.toThrow("run changed");
});
