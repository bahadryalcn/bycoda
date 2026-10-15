import { describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { openLocalHostSession } from "./openLocalHostSession";
import type { HostSession, RemoteMachine } from "./protocol";

const target = { machineId: "local", projectId: "project", sessionId: "worker" };
const project = { id: "project", cwd: "C:/repo", name: "Repo" };
function setup() {
  const snapshot: HostSession = {
    session: {
      ...newSession("codex", "C:/worktrees/task"),
      id: "worker",
      blocks: [
        { id: "u", role: "user", text: "Task prompt" },
        { id: "a", role: "assistant", text: "Working on the task" },
        { id: "t", role: "tool", text: "Test output" },
      ],
    },
    projectId: "project",
    revision: 18,
    status: "running",
    updatedAt: 100,
  };
  const deps = {
    machines: vi.fn(
      async () =>
        [
          {
            id: "local",
            localHost: true,
            name: "Renamed PC",
            endpoint: "http://127.0.0.1:3776",
            environmentId: "env",
          },
        ] as RemoteMachine[],
    ),
    projects: vi.fn(async () => [project]),
    load: vi.fn(async () => snapshot),
    find: vi.fn(async (): Promise<Session | null> => null),
    create: vi.fn(async (_copy: Session) => true),
    refresh: vi.fn(async () => false),
  };
  return { deps, snapshot };
}

describe("opening a local task conversation", () => {
  it("opens the complete host transcript under its registered project with the task worktree", async () => {
    const { deps, snapshot } = setup();
    expect(await openLocalHostSession(target, deps)).toEqual({
      sessionId: "worker",
      cwd: "C:/repo",
    });
    expect(deps.load).toHaveBeenCalledExactlyOnceWith("local", "worker");
    expect(deps.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "worker",
        cwd: "C:/repo",
        worktreeCwd: "C:/worktrees/task",
        blocks: snapshot.session.blocks,
        continuingElsewhere: true,
      }),
    );
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("refreshes an existing prompt-only copy through the conflict-safe mirror", async () => {
    const { deps, snapshot } = setup();
    deps.find.mockResolvedValue({
      ...snapshot.session,
      cwd: project.cwd,
      blocks: snapshot.session.blocks.slice(0, 1),
    });
    await openLocalHostSession(target, deps);
    expect(deps.refresh).toHaveBeenCalledExactlyOnceWith("worker", target);
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("uses the mirror if a local copy appears while the host snapshot is loading", async () => {
    const { deps, snapshot } = setup();
    deps.find
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...snapshot.session, cwd: project.cwd });
    await openLocalHostSession(target, deps);
    expect(deps.refresh).toHaveBeenCalledExactlyOnceWith("worker", target);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("recovers a refused create by refreshing the newly stored copy", async () => {
    const { deps, snapshot } = setup();
    deps.create.mockResolvedValue(false);
    deps.find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...snapshot.session, cwd: project.cwd });
    await openLocalHostSession(target, deps);
    expect(deps.refresh).toHaveBeenCalledExactlyOnceWith("worker", target);
  });

  it("rejects another machine instead of adopting its path as local", async () => {
    const { deps } = setup();
    await expect(openLocalHostSession({ ...target, machineId: "remote" }, deps)).rejects.toThrow(
      "not on this computer",
    );
    expect(deps.projects).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it.each([{ projectId: "another" }, { session: { id: "another" } }])(
    "rejects a mismatched host binding %j",
    async (over) => {
      const { deps, snapshot } = setup();
      deps.load.mockResolvedValue({ ...snapshot, ...over } as HostSession);
      await expect(openLocalHostSession(target, deps)).rejects.toThrow("another project");
      expect(deps.create).not.toHaveBeenCalled();
    },
  );

  it("keeps an unrelated local copy and reports refresh failures", async () => {
    const { deps, snapshot } = setup();
    deps.find.mockResolvedValue({ ...snapshot.session, cwd: "D:/unrelated" });
    await expect(openLocalHostSession(target, deps)).rejects.toThrow("another project");
    expect(deps.refresh).not.toHaveBeenCalled();
    deps.find.mockResolvedValue({ ...snapshot.session, cwd: project.cwd });
    deps.refresh.mockRejectedValue(new Error("offline"));
    await expect(openLocalHostSession(target, deps)).rejects.toThrow("offline");
    expect(deps.create).not.toHaveBeenCalled();
  });
});
