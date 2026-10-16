// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { clearedWorkspaceSession, newWorkspaceSession } from "./newWorkspaceSession";
import { newDefaultSession, newSession, type Session } from "../../features/sessions/model/session";

afterEach(() => localStorage.clear());
describe("new visible-workspace sessions", () => {
  it("clears provider context while preserving the source configuration and history", () => {
    const source: Session = {
      ...newSession("claude", "/project", undefined, "supervised"),
      providerAccountId: "work-account",
      providerSessionId: "old-provider-conversation",
      worktreeCwd: "/project-worktree",
      branch: "feature",
      blocks: [{ id: "old-message", role: "user", text: "old context" }],
      context: { used: 1200, window: 200000 },
      busy: true,
      queuedMessages: [{ id: "queued", text: "follow-up", attachments: [] }],
    };
    const session = clearedWorkspaceSession(source);
    expect(session.id).not.toBe(source.id);
    expect(session).toMatchObject({
      harness: source.harness,
      model: source.model,
      modelSettings: source.modelSettings,
      runtimeMode: source.runtimeMode,
      providerAccountId: source.providerAccountId,
      cwd: source.cwd,
      worktreeCwd: source.worktreeCwd,
      branch: source.branch,
      blocks: [],
    });
    expect(session.providerSessionId).toBeUndefined();
    expect(session.context).toBeUndefined();
    expect(session.busy).toBeUndefined();
    expect(session.queuedMessages).toBeUndefined();
    expect(source.blocks[0].text).toBe("old context");
    expect(source.providerSessionId).toBe("old-provider-conversation");
  });
  it("uses visible checkout defaults and preserves selected worktree/branch", () => {
    const base = newDefaultSession("/visible", "supervised");
    const session = newWorkspaceSession("/visible", "supervised", {
      path: "/visible-worktrees/feature",
      branch: "feature",
    });
    expect(session.cwd).toBe("/visible");
    expect(session.harness).toBe(base.harness);
    expect(session.model).toBe(base.model);
    expect(session.runtimeMode).toBe(base.runtimeMode);
    expect(session.worktreeCwd).toBe("/visible-worktrees/feature");
    expect(session.branch).toBe("feature");
  });
  it("does not turn an alias of the main checkout into a worktree", () => {
    expect(
      newWorkspaceSession("G:/visible", undefined, { path: "g:\\visible", branch: "main" })
        .worktreeCwd,
    ).toBeUndefined();
  });
});
