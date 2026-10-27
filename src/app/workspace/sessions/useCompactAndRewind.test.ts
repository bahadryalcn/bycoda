// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { createEditedResendCoordinator } from "../../../features/sessions/model/editLastTurn";
import { useCompactAndRewind, type CompactAndRewindDeps } from "./useCompactAndRewind";

const effects = vi.hoisted(() => ({
  forget: vi.fn(),
  providerRewind: vi.fn(),
  stop: vi.fn(),
  plan: vi.fn(),
  apply: vi.fn(),
  save: vi.fn(),
  reviewChanged: vi.fn(),
}));

vi.mock("../../../shared/i18n", () => ({ t: (value: string) => value }));
vi.mock("../../../integrations/harness", () => ({
  forgetHarnessSession: effects.forget,
  rewindHarnessLastTurn: effects.providerRewind,
  canRewindHarnessLastTurn: () => true,
  stopHarnessSession: effects.stop,
  canCompactHarnessContext: () => false,
  compactHarnessContext: vi.fn(),
  applyHarnessEvent: (session: Session) => session,
}));
vi.mock("../../../features/connections/model/remoteProjects", () => ({
  remoteProjectFor: () => undefined,
}));
vi.mock("../../../features/connections/model/remoteSessionActions", () => ({
  remoteSessionActions: () => undefined,
}));
vi.mock("../../../features/notifications/model/dockBadge", () => ({
  syncDockBadge: vi.fn(),
}));
vi.mock("../../../features/providers/model/providerAccounts", () => ({
  sessionProviderAccountId: () => undefined,
  supportsProviderAccounts: () => false,
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  shouldPersistSession: () => true,
  upsertSession: effects.save,
}));
vi.mock("../../../features/sessions/model/checkpoint", () => ({
  notifyReviewChanged: effects.reviewChanged,
}));
vi.mock("../../../features/workspaces/model/rewindClient", () => ({
  planWorkspaceRewind: effects.plan,
  applyWorkspaceRewind: effects.apply,
}));
vi.mock("../../../features/workspaces/ui/WorkspaceRewindPreview", () => ({
  clearWorkspaceRewindUndo: vi.fn(),
  requestWorkspaceRewindPreview: vi.fn(),
  registerWorkspaceRewindUndoHandler: () => () => {},
}));

let root: Root;
let deps: CompactAndRewindDeps;
let actions: ReturnType<typeof useCompactAndRewind>;

function chat(worktree = false): Session {
  return {
    ...newSession("codex", "/repo"),
    id: "session",
    providerSessionId: "provider-before-rewind",
    ...(worktree ? { workspaceId: "workspace", workspaceMode: "worktree" as const } : {}),
    blocks: [
      { id: "earlier-user", role: "user", text: "Keep earlier prompt" },
      { id: "earlier-answer", role: "assistant", text: "Keep earlier answer" },
      {
        id: "first-steer",
        role: "user",
        text: "Keep first steer in this turn",
        providerTurnId: "same-provider-turn",
      },
      { id: "steer-answer", role: "assistant", text: "Keep response to first steer" },
      {
        id: "selected-user",
        role: "user",
        text: "Edit selected prompt",
        providerTurnId: "same-provider-turn",
      },
      { id: "removed-answer", role: "assistant", text: "Remove answer after selection" },
    ],
  };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  effects.forget.mockReset().mockResolvedValue(undefined);
  effects.save.mockReset().mockResolvedValue(undefined);
  deps = {
    sessionsRef: { current: [chat()] },
    setSessions: (update) => {
      deps.sessionsRef.current =
        typeof update === "function" ? update(deps.sessionsRef.current) : update;
    },
    turnGen: { current: new Map([["session", 4]]) },
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
    retiringTurns: { current: new Map() },
    editedResends: createEditedResendCoordinator(),
    windowTransferPendingRef: { current: false },
    movingSessionIds: { current: new Set() },
    orchestrator: {
      submissionError: () => undefined,
    } as unknown as CompactAndRewindDeps["orchestrator"],
    lastBoundProvider: { current: new Map([["session", "provider-before-rewind"]]) },
    lastPersistedUserBlock: { current: new Map([["session", "selected-user"]]) },
    persistSession: vi.fn(),
  };
  function Harness() {
    actions = useCompactAndRewind(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "rewinds the exact selected message with worktree=%s, preserving earlier steers and resetting provider context",
  async (worktree) => {
    const original = chat(worktree);
    deps.sessionsRef.current = [original];
    await expect(actions.onRewindMessage("session", "selected-user")).resolves.toBe(true);
    const rewound = deps.sessionsRef.current[0];
    expect(rewound.blocks).toEqual(original.blocks.slice(0, 4));
    expect(rewound.rewindHistory?.[0]).toMatchObject({
      fromBlockId: "selected-user",
      blocks: original.blocks.slice(4),
    });
    expect(rewound.providerSessionId).toBeUndefined();
    expect(rewound.pendingContextReplay).toContain("Keep first steer in this turn");
    expect(rewound.pendingContextReplay).not.toContain("Edit selected prompt");
    expect(rewound.pendingContextReplay).not.toContain("Remove answer after selection");
    expect(effects.forget).toHaveBeenCalledWith("codex", "session");
    expect(effects.providerRewind).not.toHaveBeenCalled();
    expect(effects.stop).not.toHaveBeenCalled();
    expect(effects.plan).not.toHaveBeenCalled();
    expect(effects.apply).not.toHaveBeenCalled();
    expect(effects.save).toHaveBeenCalledWith(rewound);
    expect(deps.persistSession).toHaveBeenCalledWith(rewound);
    expect(effects.reviewChanged).toHaveBeenCalledWith("session");
    expect(deps.turnGen.current.get("session")).toBe(5);
    expect(deps.lastBoundProvider.current.has("session")).toBe(false);
    expect(deps.lastPersistedUserBlock.current.has("session")).toBe(false);
    expect(deps.editedResends.isActive("session")).toBe(false);
    expect(original.blocks).toHaveLength(6);
  },
);

it("rejects a busy conversation before provider or persistence work", async () => {
  const original = { ...chat(), busy: true };
  deps.sessionsRef.current = [original];
  await expect(actions.onRewindMessage("session", "selected-user")).resolves.toBe(false);
  expect(deps.sessionsRef.current[0]).toBe(original);
  expect(effects.forget).not.toHaveBeenCalled();
  expect(effects.save).not.toHaveBeenCalled();
  expect(deps.persistSession).not.toHaveBeenCalled();
});

it("preserves a newer conversation when state changes during provider reset", async () => {
  const original = chat();
  const newer = {
    ...original,
    blocks: [...original.blocks, { id: "new-message", role: "user" as const, text: "Newer work" }],
  };
  deps.sessionsRef.current = [original];
  effects.forget.mockImplementationOnce(async () => {
    deps.sessionsRef.current = [newer];
  });
  await expect(actions.onRewindMessage("session", "selected-user")).rejects.toThrow(
    "conversation changed",
  );
  expect(deps.sessionsRef.current[0].blocks).toBe(newer.blocks);
  expect(deps.sessionsRef.current[0].pendingContextReplay).toContain("Newer work");
  expect(effects.save).not.toHaveBeenCalled();
  expect(deps.editedResends.isActive("session")).toBe(false);
});

it("preserves visible history when durable rewind persistence fails", async () => {
  const original = chat(true);
  deps.sessionsRef.current = [original];
  effects.save.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(actions.onRewindMessage("session", "selected-user")).rejects.toThrow(
    "Storage unavailable",
  );
  expect(deps.sessionsRef.current[0].blocks).toBe(original.blocks);
  expect(deps.sessionsRef.current[0].providerSessionId).toBeUndefined();
  expect(deps.sessionsRef.current[0].pendingContextReplay).toContain("Edit selected prompt");
  expect(effects.reviewChanged).not.toHaveBeenCalled();
  expect(deps.editedResends.isActive("session")).toBe(false);
});

it("preserves a newer conversation when state changes during durable persistence", async () => {
  const original = chat();
  const newer = {
    ...original,
    blocks: [...original.blocks, { id: "new-message", role: "user" as const, text: "Newer work" }],
  };
  deps.sessionsRef.current = [original];
  effects.save.mockImplementationOnce(async () => {
    deps.sessionsRef.current = [newer];
  });
  await expect(actions.onRewindMessage("session", "selected-user")).rejects.toThrow(
    "conversation changed",
  );
  expect(deps.sessionsRef.current[0].blocks).toBe(newer.blocks);
  expect(effects.reviewChanged).not.toHaveBeenCalled();
  expect(deps.editedResends.isActive("session")).toBe(false);
});
