// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { remotePath } from "../../connections/public/remoteProjects";
import {
  projectVoiceWorkspaceWork,
  useVoiceWorkspaceTrackedWork,
} from "./voiceWorkspaceTrackedWork";

const host = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteMachineFor: vi.fn(),
  remoteRequest: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));
vi.mock("../../connections/public/connections", () => ({
  remoteMachineFor: host.remoteMachineFor,
  remoteRequest: host.remoteRequest,
}));
vi.mock("../../group-lock/public/projectLock", () => ({ isProjectLocked: () => false }));

const machine = { id: "machine-a", environmentId: "host-a" };
const projectA = { id: "alpha", cwd: "/repo/a" };
const projectB = { id: "beta", cwd: "/repo/b" };
const projects = [projectA, projectB];
const task = {
  id: "task-1",
  projectId: "alpha",
  title: "Check output",
  status: "done" as const,
  sessionId: "task-session",
  updatedAt: 10,
};
const goal = {
  id: "goal-1",
  leadProjectId: "alpha",
  projectIds: ["alpha"],
  title: "Ship output",
  taskIds: ["task-1"],
  status: "running" as const,
  updatedAt: 11,
};
const worker = {
  runId: "run-1",
  projectId: "alpha",
  definitionId: "crew-1",
  definitionName: "Release team",
  runTitle: "Review change",
  runStatus: "active" as const,
  memberId: "worker",
  memberName: "Worker",
  memberRole: "specialist" as const,
  kind: "worker" as const,
  sessionId: "worker-session",
};
const coordinator = {
  ...worker,
  memberId: "coordinator",
  memberRole: "coordinator" as const,
  kind: "coordinator" as const,
  sessionId: "coordinator-session",
};
const source = {
  path: projectA.cwd,
  machine,
  projects,
  selectedProjectId: "alpha",
  tasks: [task],
  goals: [goal],
  crew: [worker, coordinator],
};
const visibility = { paths: projects.map((project) => project.cwd), locked: () => false };

describe("voice workspace tracked work", () => {
  it("projects source record identities, complete task progress and one row per active crew run", () => {
    const rows = projectVoiceWorkspaceWork(
      { ...source, tasks: [task, { ...task, projectId: "beta", id: "unrelated" }] },
      visibility,
    );
    expect(rows).toMatchObject([
      {
        kind: "goal",
        projectId: "alpha",
        id: "goal-1",
        status: "running",
        progress: { done: 1, total: 1 },
      },
      { kind: "task", projectId: "alpha", id: "task-1", sessionId: "task-session" },
      {
        kind: "crew",
        id: "run-1",
        title: "Review change",
        summary: "Release team",
        definitionId: "crew-1",
        sessionId: "coordinator-session",
      },
    ]);
    expect(rows.every((row) => row.environmentId === machine.environmentId)).toBe(true);
    expect(rows[2]?.updatedAt).toBeUndefined();
  });

  it("removes locked work and withholds goals whose other contributing project is unavailable", () => {
    const spanning = { ...source, goals: [{ ...goal, projectIds: ["alpha", "beta"] }] };
    expect(
      projectVoiceWorkspaceWork(spanning, {
        ...visibility,
        locked: (path) => path === projectB.cwd,
      }).map((row) => row.kind),
    ).toEqual(["task", "crew"]);
    expect(projectVoiceWorkspaceWork(spanning, { ...visibility, paths: [projectB.cwd] })).toEqual(
      [],
    );
    expect(projectVoiceWorkspaceWork(spanning, { ...visibility, locked: () => true })).toEqual([]);
  });

  it("does not present incomplete goal counts or substitute an identically named remote project", () => {
    const incomplete = { ...source, goals: [{ ...goal, taskIds: ["task-1", "missing"] }] };
    expect(projectVoiceWorkspaceWork(incomplete, visibility)[0]?.progress).toBeUndefined();
    const remote = remotePath("host-b", projectA.cwd);
    expect(
      projectVoiceWorkspaceWork({ ...source, path: remote }, { ...visibility, paths: [remote] }),
    ).toEqual([]);
  });

  it("reads only pinned owner methods and strips raw details before exposing rows", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host.invoke.mockResolvedValue(machine);
    host.remoteRequest.mockImplementation(async (_id: string, method: string): Promise<unknown> => {
      switch (method) {
        case "environment.describe":
          return {
            environmentId: machine.environmentId,
            capabilities: ["tasks", "goals", "crews.active.v1"],
          };
        case "projects.list":
          return projects;
        case "tasks.list":
          return [{ ...task, prompt: "Private task input" }];
        case "goals.list":
          return [{ ...goal, prompt: "Private goal input" }];
        case "crews.active.list":
          return { items: [worker, coordinator] };
      }
      throw new Error("Unexpected method");
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    function Fixture() {
      const work = useVoiceWorkspaceTrackedWork({
        enabled: true,
        projectPath: source.path,
        visibleProjectPaths: visibility.paths,
      });
      return JSON.stringify(work);
    }
    try {
      await act(async () => root.render(createElement(Fixture)));
      expect(container.textContent).toContain("Check output");
      expect(container.textContent).toContain("Ship output");
      expect(container.textContent).toContain("Review change");
      expect(container.textContent).not.toContain("Private");
      expect(host.remoteMachineFor).not.toHaveBeenCalled();
      expect(host.remoteRequest.mock.calls).toEqual([
        ["machine-a", "environment.describe", {}, false, false, "host-a"],
        ["machine-a", "projects.list", {}, false, false, "host-a"],
        ["machine-a", "tasks.list", { projectId: "alpha" }, false, false, "host-a"],
        ["machine-a", "goals.list", {}, false, false, "host-a"],
        ["machine-a", "crews.active.list", { limit: 200 }, false, false, "host-a"],
      ]);
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
