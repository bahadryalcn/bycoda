import { expect, it, vi } from "vitest";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { dispatchSessionManagement } from "./conversation-session-management";

function setup() {
  const source = {
    projectId: "project",
    revision: 4,
    authorityGeneration: 2,
    status: "idle",
    session: {
      id: "target",
      harness: "codex",
      model: "codex:default",
      runtimeMode: "supervised",
      modelSettings: {},
      blocks: [],
    },
  } as unknown as HostSession;
  const ports = {
    session: vi.fn(async () => source),
    preview: vi.fn(async () => ({ digest: "a".repeat(64), contextText: "reviewed context" })),
    dispatch: vi.fn(async () => ({ sessionId: "target", revision: 5 })),
    modelPool: async () => ({
      rows: [
        {
          id: "row-1",
          harness: "claude" as const,
          model: "claude:sonnet",
          modelSettings: {},
          runtimeMode: "supervised" as const,
          maxRunMinutes: 30,
          roles: ["worker" as const],
          unknownLimit: "use" as const,
        },
      ],
    }),
  };
  const principal = {
    kind: "assistant-thread" as const,
    threadId: "thread",
    projectId: "project",
    provider: "assistant" as const,
  };
  const authorized = vi.fn(async () => true);
  const configure = {
    requestId: "change-1",
    sessionId: "target",
    expectedRevision: 4,
    model: "claude:sonnet",
    harness: "claude",
    modelSettings: {},
    runtimeMode: "supervised",
  };
  const contextual = {
    sessionId: "target",
    sourceBlockId: "reply",
    expectedRevision: 4,
    mode: "handoff",
    harness: "claude",
    model: "claude:sonnet",
    modelSettings: {},
  };
  return { source, ports, principal, authorized, configure, contextual };
}

it("reads bounded configuration without exposing transcript or starting a command", async () => {
  const { source, ports, principal, authorized } = setup();
  source.session.blocks = [
    { id: "private", role: "user", text: "private" },
  ] as HostSession["session"]["blocks"];
  const result = await dispatchSessionManagement(
    "sessions.configuration",
    { sessionId: "target" },
    principal,
    authorized,
    ports,
  );
  expect(result).toMatchObject({ sessionId: "target", revision: 4, harness: "codex" });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(ports.dispatch).not.toHaveBeenCalled();
});

it("preserves revision and authority fences when dispatching a provider/model change", async () => {
  const { ports, principal, authorized, configure } = setup();
  await dispatchSessionManagement("sessions.configure", configure, principal, authorized, ports);
  expect(ports.dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "configure",
    commandId: "change-1",
    sessionId: "target",
    expectedRevision: 4,
    authorityGeneration: 2,
    harness: "claude",
    model: "claude:sonnet",
    modelSettings: {},
    runtimeMode: "supervised",
  });
});

it.each(["foreign", "stale", "revoked", "extra"])(
  "rejects %s management before effects",
  async (kind) => {
    const { source, ports, principal, authorized, configure } = setup();
    if (kind === "foreign") source.projectId = "other";
    if (kind === "stale") source.revision = 5;
    if (kind === "revoked")
      ports.session.mockImplementation(async () => {
        authorized.mockResolvedValue(false);
        return source;
      });
    if (kind === "extra") Object.assign(configure, { approved: true });
    await expect(
      dispatchSessionManagement("sessions.configure", configure, principal, authorized, ports),
    ).rejects.toThrow();
    expect(ports.dispatch).not.toHaveBeenCalled();
  },
);

it("previews then dispatches an unsent handoff with its exact digest", async () => {
  const { ports, principal, authorized, contextual } = setup();
  await expect(
    dispatchSessionManagement(
      "sessions.contextual.preview",
      contextual,
      principal,
      authorized,
      ports,
    ),
  ).resolves.toMatchObject({ digest: "a".repeat(64) });
  expect(ports.dispatch).not.toHaveBeenCalled();
  await dispatchSessionManagement(
    "sessions.contextual.create",
    { ...contextual, requestId: "handoff-1", previewDigest: "a".repeat(64) },
    principal,
    authorized,
    ports,
  );
  expect(ports.dispatch).toHaveBeenCalledExactlyOnceWith({
    ...contextual,
    type: "contextual",
    commandId: "handoff-1",
    previewDigest: "a".repeat(64),
    authorityGeneration: 2,
  });
  await expect(
    dispatchSessionManagement(
      "sessions.contextual.create",
      { ...contextual, mode: "secondOpinion", requestId: "send-1", previewDigest: "a".repeat(64) },
      principal,
      authorized,
      ports,
    ),
  ).rejects.toThrow();
  expect(ports.dispatch).toHaveBeenCalledOnce();
});

it("reuses only accepted attachment metadata and never forwards filesystem paths or bytes", async () => {
  const { source, ports, principal, authorized } = setup();
  const attachment = {
    id: "6b242a58-bc5b-46d3-9702-2b5194e841da",
    name: "note.txt",
    mimeType: "text/plain",
    size: 3,
    kind: "file",
    path: "C:/private/source",
    data: "private-bytes",
  };
  source.session.blocks = [
    { id: "accepted", role: "user", text: "read this", attachments: [attachment] },
  ] as HostSession["session"]["blocks"];
  await dispatchSessionManagement(
    "sessions.draft",
    {
      sessionId: "target",
      requestId: "draft-1",
      expectedRevision: 4,
      text: "",
      attachmentIds: [attachment.id],
    },
    principal,
    authorized,
    ports,
  );
  expect(ports.dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "draft",
    commandId: "draft-1",
    sessionId: "target",
    expectedRevision: 4,
    authorityGeneration: 2,
    text: "",
    attachments: [
      { id: attachment.id, name: "note.txt", mimeType: "text/plain", size: 3, kind: "file" },
    ],
  });
  expect(JSON.stringify(ports.dispatch.mock.calls)).not.toContain("private");
});

it.each(["unknown", "unsent", "missing"])("refuses %s attachment IDs", async (kind) => {
  const { source, ports, principal, authorized } = setup();
  source.session.blocks = [
    {
      id: "user",
      role: "user",
      text: "",
      draft: kind === "unsent",
      attachments: [
        {
          id: "file",
          missing: kind === "missing",
          name: "file.txt",
          mimeType: "text/plain",
          size: 1,
          kind: "file",
        },
      ],
    },
  ] as HostSession["session"]["blocks"];
  await expect(
    dispatchSessionManagement(
      "sessions.draft",
      {
        sessionId: "target",
        requestId: "draft-1",
        expectedRevision: 4,
        text: "",
        attachmentIds: [kind === "unknown" ? "other" : "file"],
      },
      principal,
      authorized,
      ports,
    ),
  ).rejects.toThrow("not an accepted file");
  expect(ports.dispatch).not.toHaveBeenCalled();
});

it("rejects oversized voice drafts before native review or dispatch", async () => {
  const { ports, principal, authorized } = setup();
  await expect(
    dispatchSessionManagement(
      "sessions.draft",
      { requestId: "large", sessionId: "target", expectedRevision: 4, text: "x".repeat(12_001) },
      principal,
      authorized,
      ports,
    ),
  ).rejects.toThrow();
  expect(ports.dispatch).not.toHaveBeenCalled();
});

it("rejects a model outside the pool for the assistant thread but not for a focused session", async () => {
  const { ports, principal, authorized, configure } = setup();
  const outside = { ...configure, model: "claude:opus" };
  await expect(
    dispatchSessionManagement("sessions.configure", outside, principal, authorized, ports),
  ).rejects.toThrow("not in the assistant's model pool");
  await expect(
    dispatchSessionManagement(
      "sessions.contextual.preview",
      {
        sessionId: "target",
        sourceBlockId: "reply",
        expectedRevision: 4,
        mode: "handoff",
        harness: "claude",
        model: "claude:opus",
        modelSettings: {},
      },
      principal,
      authorized,
      ports,
    ),
  ).rejects.toThrow("model pool");
  expect(ports.dispatch).not.toHaveBeenCalled();
  const session = { kind: "session" as const, sessionId: "target", projectId: "project" };
  await dispatchSessionManagement(
    "sessions.configure",
    outside,
    session as never,
    authorized,
    ports,
  );
  expect(ports.dispatch).toHaveBeenCalledOnce();
});
it("applies pool row settings when the assistant thread configures a pool model", async () => {
  const { ports, principal, authorized, configure } = setup();
  const pool = await ports.modelPool();
  ports.modelPool = async () => ({
    rows: pool.rows.map((row) => ({ ...row, modelSettings: { effort: "high" } })),
  });
  await dispatchSessionManagement("sessions.configure", configure, principal, authorized, ports);
  expect(ports.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ model: "claude:sonnet", modelSettings: { effort: "high" } }),
  );
});
