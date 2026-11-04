import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./sessionWindowOwnership", () => ({
  claimRestoredSession: vi.fn().mockResolvedValue(true),
  abortRestoredSession: vi.fn().mockResolvedValue(undefined),
  remoteSessionOwnershipKey: (cwd: string, id: string) => `remote:${cwd}:${id}`,
}));
import { newSession, type Session } from "../../features/sessions/model/session";
import { newTab } from "../../features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";

const store = vi.hoisted(() => ({
  loadWorkspaceSnapshot: vi.fn(),
  listInFlightSessions: vi.fn(),
  listDeletedSessionIds: vi.fn(),
  getSession: vi.fn(),
  upsertSession: vi.fn(),
}));
vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<typeof import("../../features/sessions/data/sessionStore")>()),
  ...store,
}));
const probe = vi.hoisted(() => ({ probeTurnTail: vi.fn(), readTurnSteps: vi.fn() }));
vi.mock("../../platform/tauri/turnProbe", () => probe);

const line = (record: unknown) => JSON.stringify(record);
const transcript = [
  line({ type: "user", message: { role: "user", content: "fix the bug" } }),
  line({
    type: "assistant",
    message: {
      id: "m1",
      role: "assistant",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
    },
  }),
  line({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt" }],
    },
  }),
  line({
    type: "assistant",
    message: {
      id: "m2",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Fixed." }],
    },
  }),
].join("\n");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  store.upsertSession.mockResolvedValue(null);
  store.listDeletedSessionIds.mockResolvedValue([]);
});

function inFlightChat() {
  const session: Session = {
    ...newSession("claude", "/repo"),
    id: "s1",
    providerSessionId: "p1",
    busy: true,
    blocks: [{ id: "u1", role: "user" as const, text: "fix the bug" }],
  };
  const tab = newTab(session.id);
  store.loadWorkspaceSnapshot.mockResolvedValue(
    collectWorkspaceSnapshot([tab], [session], tab.id, "/repo", new Map()),
  );
  store.listInFlightSessions.mockResolvedValue([{ sessionId: session.id, cwd: "/repo" }]);
  store.getSession.mockResolvedValue(session);
  return session;
}

it("preserves owner Stop when an old in-flight reference survives a restart", async () => {
  const session = inFlightChat();
  session.blocks.push({
    id: "stop",
    role: "system",
    text: "Stopped by you.",
    notice: "interrupt",
  });
  probe.probeTurnTail.mockResolvedValue({ state: "missing" });
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions[0].blocks).toEqual(session.blocks);
  expect(restored?.sessions[0].busy).toBe(false);
  expect(probe.probeTurnTail).not.toHaveBeenCalled();
  expect(probe.readTurnSteps).not.toHaveBeenCalled();
});

it("preserves legacy Stop plus erroneous quit marker without probing or resuming", async () => {
  const session = inFlightChat();
  session.blocks.push(
    { id: "stop", role: "system", text: "Stopped by you.", notice: "interrupt" },
    { id: "quit", role: "system", text: "Turn interrupted when bycoda quit.", notice: "interrupt" },
  );
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions[0].blocks).toEqual(session.blocks);
  expect(probe.probeTurnTail).not.toHaveBeenCalled();
  expect(probe.readTurnSteps).not.toHaveBeenCalled();
});

it("shows what a finished turn did while the app was closed, once", async () => {
  inFlightChat();
  probe.probeTurnTail.mockResolvedValue({ state: "ended", finalText: "Fixed." });
  probe.readTurnSteps.mockResolvedValue({ text: transcript, startReached: true });
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  const blocks = restored?.sessions[0].blocks ?? [];
  expect(blocks.map((block) => block.role)).toEqual(["user", "tool", "assistant"]);
  expect(blocks[1].tool?.callId).toBe("t1");
  expect(blocks.some((block) => block.notice === "interrupt")).toBe(false);
});

it("shows the recorded steps of a cut-off turn before the interrupted note", async () => {
  inFlightChat();
  probe.probeTurnTail.mockResolvedValue({ state: "open" });
  probe.readTurnSteps.mockResolvedValue({
    text: transcript.split("\n").slice(0, 3).join("\n"),
    startReached: true,
  });
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  const blocks = restored?.sessions[0].blocks ?? [];
  expect(blocks.map((block) => block.role)).toEqual(["user", "tool", "system"]);
  expect(blocks[2].notice).toBe("interrupt");
});

it("falls back to the final reply alone when the steps cannot be read", async () => {
  inFlightChat();
  probe.probeTurnTail.mockResolvedValue({ state: "ended", finalText: "Fixed." });
  probe.readTurnSteps.mockRejectedValue(new Error("no transcript"));
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions[0].blocks.map((block) => block.role)).toEqual(["user", "assistant"]);
});
