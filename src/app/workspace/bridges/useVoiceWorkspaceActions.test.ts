import { describe, expect, it, vi } from "vitest";
import { createVoiceWorkspaceActions } from "./useVoiceWorkspaceActions";
import type {
  VoiceWorkspaceActionsDeps,
  VoiceWorkspaceSession,
} from "../../../features/voice/model/voiceWorkspaceActions";
import { voiceProjectNames } from "../../../features/voice/model/voiceProjectNames";

const entry = (
  id: string,
  cwd = "/project",
  extra: Partial<VoiceWorkspaceSession> = {},
): VoiceWorkspaceSession => ({ id, cwd, title: id, harness: "codex", model: "model", ...extra });
function setup(overrides: Partial<VoiceWorkspaceActionsDeps> = {}) {
  const deps: VoiceWorkspaceActionsDeps = {
    getProjects: () => [{ path: "/project" }, { path: "/other" }],
    getSessions: () => [entry("first"), entry("second", "/other")],
    getActiveSessionId: () => "first",
    getProjectPath: () => "/project",
    ...overrides,
  };
  return { deps, ...createVoiceWorkspaceActions(() => deps) };
}
const args = { sessionId: "first", projectPath: "/project", requestId: "request-1" };

describe("voice workspace owner actions", () => {
  it("resolves the display/folder aliases but creates only at the exact listed cwd, preserving ambiguity and access", async () => {
    const path = "G:/Projects/my_projects/monocode",
      onCreate = vi.fn(async () => "exact-session");
    const { deps, execute } = setup({
      getProjects: () => voiceProjectNames([{ path, name: "bycoda" }]),
      onCreate,
    });
    const resolved = await execute("workspace.projects.resolve", { query: "bycoda" });
    expect(resolved).toMatchObject({
      ambiguous: false,
      projects: [{ path, name: "bycoda", folderName: "monocode" }],
    });
    expect(
      await execute("workspace.sessions.create", { projectPath: "bycoda", requestId: "bad-alias" }),
    ).toMatchObject({ status: "rejected" });
    expect(onCreate).not.toHaveBeenCalled();
    expect(
      await execute("workspace.sessions.create", {
        projectPath: path,
        requestId: "original-create",
      }),
    ).toMatchObject({ sessionId: "exact-session", projectPath: path, submitted: false });
    expect(onCreate).toHaveBeenCalledWith({
      projectPath: path,
      requestId: "original-create",
      prompt: "",
      submit: false,
    });
    deps.getProjects = () =>
      voiceProjectNames([
        { path, name: "bycoda" },
        { path: "remote://other/work/monocode", name: "bycoda" },
      ]);
    expect(await execute("workspace.projects.resolve", { query: "bycoda" })).toMatchObject({
      ambiguous: true,
      total: 2,
    });
    deps.getProjects = () => [];
    expect(await execute("workspace.projects.resolve", { query: "bycoda" })).toMatchObject({
      projects: [],
      total: 0,
    });
    expect(
      await execute("workspace.sessions.create", { projectPath: path, requestId: "after-lock" }),
    ).toMatchObject({ status: "rejected" });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
  it("merges stored and loaded metadata without exposing hidden workers or another project's sessions", async () => {
    const { execute } = setup({
      listSessions: async () => [
        entry("first", "/project", { busy: false }),
        entry("stored"),
        entry("hidden", "/project", { inboxAsk: {} }),
        entry("foreign", "/other"),
      ],
      getSessions: () => [
        entry("first", "/project", { busy: true }),
        entry("worker", "/project", { orchestrationLeadId: "first" }),
      ],
    });
    const result = await execute("workspace.sessions.list", { projectPath: "/project", limit: 1 });
    expect(result).toMatchObject({
      status: "completed",
      total: 2,
      nextOffset: 1,
      coverage: "stored-and-loaded",
      sessions: [{ id: "first", busy: true }],
    });
    expect(result.sessions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "hidden" })]),
    );
  });

  it("does not label a loaded-only list as complete stored history", async () => {
    const result = await setup().execute("workspace.sessions.list", { projectPath: "/project" });
    expect(result.coverage).toBe("loaded-only");
  });

  it("refuses a target in a different project without invoking its callback", async () => {
    const onDelete = vi.fn();
    const { execute } = setup({ onDelete });
    expect(
      await execute("workspace.sessions.delete", { ...args, sessionId: "second" }),
    ).toMatchObject({ status: "rejected" });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("rechecks access after loading a stored session before any effect", async () => {
    const onStop = vi.fn();
    const { deps, execute } = setup({ getSessions: () => [], onStop });
    deps.resolveSession = async () => {
      deps.getProjects = () => [];
      return entry("first");
    };
    expect(await execute("workspace.sessions.stop", args)).toMatchObject({
      status: "rejected",
      error: expect.stringContaining("locked"),
    });
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does not retarget a delayed action when the active session changes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const { deps, execute } = setup({ getSessions: () => [], onSubmit });
    deps.resolveSession = async () => {
      deps.getActiveSessionId = () => "second";
      return entry("first");
    };
    expect(
      await execute("workspace.sessions.submit", { ...args, text: "my exact request" }),
    ).toMatchObject({ status: "accepted", sessionId: "first" });
    expect(onSubmit).toHaveBeenCalledWith("first", "my exact request");
  });

  it("coalesces identical in-flight retries and rejects request ID reuse with another payload", async () => {
    let finish!: (value: boolean) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { execute } = setup({ onSubmit });
    const first = execute("workspace.sessions.submit", { ...args, text: "one" });
    const duplicate = execute("workspace.sessions.submit", { text: "one", ...args });
    await Promise.resolve();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(await execute("workspace.sessions.submit", { ...args, text: "two" })).toMatchObject({
      status: "rejected",
      error: expect.stringContaining("different input"),
    });
    finish(true);
    expect(await first).toEqual(await duplicate);
  });

  it("reports a fire-and-forget close as accepted, never completed", async () => {
    const onClose = vi.fn();
    expect(await setup({ onClose }).execute("workspace.sessions.close", args)).toMatchObject({
      status: "accepted",
    });
    expect(onClose).toHaveBeenCalledWith("first");
  });

  it("honors existing owner deletion cancellation", async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    expect(await setup({ onDelete }).execute("workspace.sessions.delete", args)).toMatchObject({
      status: "cancelled",
    });
    expect(onDelete).toHaveBeenCalledWith("first");
  });

  it("refuses unavailable callbacks and sessions unready for submission", async () => {
    expect(await setup().execute("workspace.sessions.stop", args)).toMatchObject({
      status: "rejected",
      error: expect.stringContaining("not available"),
    });
    const onSubmit = vi.fn();
    expect(
      await setup({
        onSubmit,
        getSessions: () => [entry("first", "/project", { historyLoading: true })],
      }).execute("workspace.sessions.submit", { ...args, text: "work" }),
    ).toMatchObject({ status: "rejected" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("creates a draft by default and preserves explicit work separately", async () => {
    const onCreate = vi.fn().mockResolvedValue("created");
    const { execute } = setup({ onCreate });
    expect(
      await execute("workspace.sessions.create", {
        projectPath: "/project",
        requestId: "new",
        prompt: "unsent text",
      }),
    ).toMatchObject({ status: "accepted", sessionId: "created", submitted: false });
    expect(onCreate).toHaveBeenCalledWith({
      projectPath: "/project",
      requestId: "new",
      prompt: "unsent text",
      submit: false,
    });
  });

  it("rejects malformed actions before calling owner callbacks", async () => {
    const onArchive = vi.fn();
    const { execute } = setup({ onArchive });
    expect(
      await execute("workspace.sessions.archive", { ...args, archived: true, confirmed: true }),
    ).toMatchObject({ status: "rejected" });
    expect(await execute("workspace.sessions.archive", { ...args, archived: "yes" })).toMatchObject(
      { status: "rejected" },
    );
    expect(
      await execute("workspace.sessions.archive", { sessionId: "first", archived: true }),
    ).toMatchObject({ status: "rejected" });
    expect(onArchive).not.toHaveBeenCalled();
  });
});
