import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { shouldPersistSession } from "../../sessions/data/sessionStore";
import { isTextOnlyChange } from "../../sessions/model/sessionsStore";
import type { HostSession } from "./protocol";
import { remoteSessionState } from "./remoteSessionState";

it("keeps every non-block field's object across a text-only remote delta", () => {
  const shell = newSession("codex", "remote://env/repo");
  const project = { key: shell.cwd, environmentId: "env", projectId: "p", cwd: "/repo" };
  const host = (text: string, revision: number, title = "Work") =>
    ({
      projectId: "p",
      revision,
      status: "running",
      updatedAt: revision,
      session: {
        ...shell,
        id: "host-session",
        cwd: "/repo",
        title,
        // Every sync parses fresh objects for the same values.
        modelSettings: { effort: "high" },
        context: { used: 10, window: 100 },
        blocks: [{ id: "reply", role: "assistant", text, streaming: true }],
      },
    }) as HostSession;
  const first = remoteSessionState(shell, host("Wor", 1), project);
  const second = remoteSessionState(first, host("Working", 2), project);
  expect(second.modelSettings).toBe(first.modelSettings);
  expect(second.context).toBe(first.context);
  expect(isTextOnlyChange([first], [second])).toBe(true);
  const renamed = remoteSessionState(second, host("Working", 3, "Renamed"), project);
  expect(renamed.title).toBe("Renamed");
  expect(isTextOnlyChange([second], [renamed])).toBe(false);
});

it("preserves managed execution identity separately from the remote project checkout", () => {
  const shell = newSession("codex", "remote://env/repo");
  const project = { key: shell.cwd, environmentId: "env", projectId: "p", cwd: "/repo" };
  const snapshot = {
    projectId: "p",
    revision: 3,
    status: "idle",
    updatedAt: 1,
    session: {
      ...shell,
      id: "host-session",
      cwd: "/repo",
      workspaceId: "managed",
      workspaceRevision: 9,
      worktreeCwd: "/worktrees/wt-owned",
    },
  } as HostSession;
  expect(remoteSessionState(shell, snapshot, project)).toMatchObject({
    id: shell.id,
    cwd: shell.cwd,
    workspaceId: "managed",
    workspaceRevision: 9,
    worktreeCwd: "remote://env/worktrees/wt-owned",
    worktreeRemoved: false,
  });
  snapshot.session.worktreeCwd = "remote://env/worktrees/wt-owned";
  expect(remoteSessionState(shell, snapshot, project).worktreeCwd).toBe(
    "remote://env/worktrees/wt-owned",
  );
  snapshot.session.worktreeCwd = undefined;
  const unavailable = remoteSessionState(shell, snapshot, project);
  expect(unavailable.worktreeCwd).toBeUndefined();
  expect(unavailable.worktreeRemoved).toBe(true);
});

it("uses host status for running and finished turns even with stale busy fields", () => {
  const shell = newSession("codex", "remote://env/repo");
  const project = { key: shell.cwd, environmentId: "env", projectId: "p", cwd: "/repo" };
  const snapshot = {
    session: { ...shell, busy: false },
    projectId: "p",
    revision: 1,
    status: "running",
    updatedAt: 1,
  } as HostSession;
  expect(remoteSessionState(shell, snapshot, project).busy).toBe(true);
  expect(
    remoteSessionState(
      shell,
      {
        ...snapshot,
        status: "idle",
        session: { ...shell, busy: true },
      },
      project,
    ).busy,
  ).toBe(false);
});

it("keeps a host transcript in normal session state under its local tab ID", () => {
  const shell = newSession("codex", "remote://env/home/me/repo");
  const snapshot = {
    projectId: "project",
    revision: 2,
    status: "idle",
    updatedAt: 1,
    session: {
      ...shell,
      id: "host-session",
      cwd: "/home/me/repo-worktrees/dev",
      title: "Fix the build",
      blocks: [
        { id: "turn", role: "user", text: "Fix it" },
        { id: "plan", role: "plan", text: "Build the fix" },
      ],
    },
  } as HostSession;
  const session = remoteSessionState(shell, snapshot, {
    key: shell.cwd,
    environmentId: "env",
    projectId: "project",
    cwd: "/home/me/repo",
  });
  expect(session).toMatchObject({
    id: shell.id,
    cwd: shell.cwd,
    worktreeCwd: "remote://env/home/me/repo-worktrees/dev",
    title: "Fix the build",
    blocks: snapshot.session.blocks,
  });
  expect(shouldPersistSession(session)).toBe(false);
});
