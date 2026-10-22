import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { shouldPersistSession } from "../../sessions/data/sessionStore";
import type { HostSession } from "./protocol";
import { remoteSessionState } from "./remoteSessionState";

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
