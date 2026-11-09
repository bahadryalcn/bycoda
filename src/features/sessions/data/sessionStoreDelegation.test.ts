import { describe, expect, it, vi } from "vitest";
import {
  DELEGATION_PARENT_KEY,
  isUserConversation,
} from "../../../shared/model/host-contracts/delegation";
import type { Session } from "../model/session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

const parent = {
  parentSessionId: "parent",
  runId: "run",
  kind: "subagent",
  model: "codex:model",
  startedAt: 1,
};

function child(): Session {
  return {
    id: "child",
    title: "Delegated task",
    cwd: "/repo",
    harness: "codex",
    model: "model",
    modelSettings: { [DELEGATION_PARENT_KEY]: JSON.stringify(parent) },
    runtimeMode: "supervised",
    blocks: [{ id: "user", role: "user", text: "work" }],
    busy: false,
  } as Session;
}

// The native summary has no settings column, like the real store's.
const nativeSummary = (revision: number) => ({
  id: "child",
  cwd: "/repo",
  title: "Delegated task",
  harness: "codex",
  model: "model",
  runtimeMode: "supervised",
  createdAt: 1,
  updatedAt: revision,
  lastActivityAt: revision,
  transcriptRevision: revision,
  additions: 0,
  deletions: 0,
});

describe("saved session summaries", () => {
  it("keep a delegated child's parent link so recent lists can hide it", async () => {
    vi.resetModules();
    mocks.invoke.mockReset();
    const store = await import("./sessionStore");

    mocks.invoke.mockResolvedValueOnce(nativeSummary(1));
    const replaced = await store.saveSessionIdle(child());
    expect(replaced?.summary?.delegationParent).toEqual(parent);
    expect(isUserConversation(replaced?.summary)).toBe(false);

    mocks.invoke.mockResolvedValueOnce({
      updatedAt: 2,
      revision: 2,
      summary: nativeSummary(2),
    });
    const delta = await store.saveSessionIdle(child());
    expect(mocks.invoke).toHaveBeenLastCalledWith("session_apply_delta", expect.anything());
    expect(isUserConversation(delta?.summary)).toBe(false);

    mocks.invoke.mockResolvedValueOnce(nativeSummary(3));
    expect(isUserConversation(await store.upsertSession(child()))).toBe(false);
  });
});
