// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantProjectJob,
  AssistantQuickNoteJob,
} from "../../../shared/model/host-contracts/assistant";
import { assistantJobProjectIds, assistantJobVisible } from "../../assistant/model/assistantJobs";
import { useVoiceWorkspaceJobs, voiceWorkspaceJobs } from "./voiceWorkspaceJobs";

vi.mock("../../group-lock/public/projectLock", () => ({ isProjectLocked: () => false }));

const directory = [
  { id: "alpha", path: "G:/work/alpha", name: "Alpha" },
  { id: "beta", path: "G:/work/beta", name: "Beta" },
];
const visibility = {
  visibleProjectPaths: directory.map((project) => project.path),
  jobVisible: assistantJobVisible,
  jobProjectIds: assistantJobProjectIds,
};
const open = () => false;
const job: AssistantProjectJob = {
  id: "job-a",
  projectId: "alpha",
  version: 3,
  createdAt: 10,
  updatedAt: 20,
  title: "Review alpha",
  request: "Private job prompt",
  status: "running",
  taskIds: ["task-a"],
  goalId: "goal-a",
  sessionIds: ["session-a", "session-detached"],
  detachedSessionIds: ["session-detached"],
  progress: { done: 1, total: 3 },
  summary: "One task completed.",
  tokens: 0,
  idempotencyKey: "job-key",
  dispatchState: "submitted",
};
const note: AssistantQuickNoteJob = {
  ...job,
  kind: "quick",
  id: "note",
  projectId: null,
  projectIds: [],
  goalId: undefined,
  title: "Write a note",
  sessionIds: [],
  taskIds: [],
  quickAction: { kind: "note", title: "Note", body: "Private note body" },
};

describe("voice workspace jobs", () => {
  it("projects current progress and exact links, excluding detached sessions and private request data", () => {
    const [row] = voiceWorkspaceJobs(
      [{ ...job, status: "done", progress: { done: 3, total: 3 } }],
      "host-a",
      directory,
      { ...visibility, scope: { kind: "global" } },
      open,
    );
    expect(row).toEqual({
      id: "job-a",
      environmentId: "host-a",
      title: "Review alpha",
      status: "done",
      dispatchState: "submitted",
      progress: { done: 3, total: 3 },
      summary: "One task completed.",
      updatedAt: 20,
      projectNames: ["Alpha"],
      sessionIds: ["session-a"],
      taskIds: ["task-a"],
      goalId: "goal-a",
    });
  });

  it("hides a multi-project job if any contributor is locked or missing from the current rail", () => {
    const mixed = { ...job, projectIds: ["alpha", "beta"] };
    const scope = { ...visibility, scope: { kind: "global" } } as const;
    expect(
      voiceWorkspaceJobs([mixed], "host-a", directory, scope, (path) => path.endsWith("/beta")),
    ).toEqual([]);
    expect(
      voiceWorkspaceJobs(
        [mixed],
        "host-a",
        directory,
        { ...scope, visibleProjectPaths: ["G:/work/alpha"] },
        open,
      ),
    ).toEqual([]);
    expect(voiceWorkspaceJobs([mixed], "host-a", directory.slice(0, 1), scope, open)).toEqual([]);
  });

  it("uses the same selected project scope as voice tools and sorts visible global work", () => {
    const mixed = { ...job, id: "mixed", projectIds: ["alpha", "beta"], updatedAt: 21 };
    expect(
      voiceWorkspaceJobs(
        [job, note, mixed],
        "host-a",
        directory,
        { ...visibility, scope: { kind: "project", path: "g:\\work\\alpha" } },
        open,
      ).map(({ id }) => id),
    ).toEqual(["job-a"]);
    expect(
      voiceWorkspaceJobs(
        [job, note, mixed],
        "host-a",
        directory,
        { ...visibility, scope: { kind: "global" } },
        open,
      ).map(({ id }) => id),
    ).toEqual(["mixed", "job-a", "note"]);
  });

  it("ignores a late project directory after the snapshot Host changes and observes job updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const replies = new Map<string, (value: { projects: typeof directory }) => void>();
    const request = vi.fn(
      (_input: { op: "projects.list" }, environmentId: string) =>
        new Promise<{ projects: typeof directory }>((resolve) =>
          replies.set(environmentId, resolve),
        ),
    );
    function Fixture({ environmentId, done }: { environmentId: string; done: number }) {
      const jobs = useVoiceWorkspaceJobs({
        ...visibility,
        enabled: true,
        environmentId,
        snapshot: { jobs: [{ ...job, progress: { done, total: 3 } }] },
        scope: { kind: "global" },
        request,
      });
      return jobs.map((item) => `${item.environmentId} ${item.progress.done}`).join("");
    }
    const render = (environmentId: string, done: number) =>
      act(() => root.render(createElement(Fixture, { environmentId, done })));
    try {
      await render("host-a", 1);
      await render("host-b", 1);
      await act(async () => replies.get("host-a")?.({ projects: directory }));
      expect(container.textContent).toBe("");
      await act(async () => replies.get("host-b")?.({ projects: directory }));
      expect(container.textContent).toBe("host-b 1");
      await render("host-b", 2);
      expect(container.textContent).toBe("host-b 2");
      expect(request.mock.calls).toEqual([
        [{ op: "projects.list" }, "host-a"],
        [{ op: "projects.list" }, "host-b"],
      ]);
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
