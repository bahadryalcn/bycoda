import { describe, expect, it } from "vitest";
import type { HostSession } from "../../connections/model/protocol";
import type { Block, Session } from "../../sessions/model/session";
import {
  backgroundSessionSummary,
  taskBackgroundSessionTarget,
  taskSessionIds,
} from "./backgroundSession";
import type { HostTask } from "./hostTasks";

const block = (role: Block["role"], text: string, id = role): Block => ({
  id,
  role,
  text,
});

const host = (
  blocks: Block[],
  status: HostSession["status"] = "idle",
  session: Partial<Session> = {},
): HostSession =>
  ({
    projectId: "project-1",
    revision: 1,
    status,
    updatedAt: 1,
    session: {
      id: "session-1",
      title: "Nightly audit",
      harness: "claude",
      blocks,
      ...session,
    },
  }) as HostSession;

describe("background session summary", () => {
  it("shows the last reply and the last host note", () => {
    expect(
      backgroundSessionSummary(
        host([
          block("user", "Review the repository"),
          block("assistant", "First look", "a1"),
          block("assistant", "  All clear.  ", "a2"),
          block("assistant", "   ", "a3"),
          block("system", "Stopped after 30 minutes."),
        ]),
      ),
    ).toEqual({
      title: "Nightly audit",
      status: "Idle",
      reply: "All clear.",
      note: "Stopped after 30 minutes.",
    });
  });

  it("says when a running session waits on the owner", () => {
    expect(backgroundSessionSummary(host([], "running")).status).toBe("Running");
    expect(
      backgroundSessionSummary(
        host([], "running", {
          pendingQuestion: { requestId: 1, questions: [] } as never,
        }),
      ),
    ).toMatchObject({ status: "Waiting for input", reply: "", note: "" });
    expect(backgroundSessionSummary(host([], "interrupted")).status).toBe("Interrupted");
  });
});

describe("task session navigation", () => {
  it("opens the current worker and running reviewer instead of the previous review", () => {
    const task = {
      status: "verifying",
      sessionId: "worker-current",
      reviewer: { sessionId: "review-current" },
      verification: { review: { sessionId: "review-previous" } },
    } as HostTask;
    expect(taskSessionIds(task)).toEqual({
      worker: "worker-current",
      review: "review-current",
    });
    expect(taskSessionIds({ ...task, status: "review" })).toEqual({
      worker: "worker-current",
      review: "review-previous",
    });
  });

  it("keeps the latest retained sessions reachable when current fields are absent", () => {
    expect(
      taskSessionIds({
        status: "done",
        attemptHistory: [
          {
            workerSessionId: "worker-initial",
            reviewerSessionId: "review-initial",
          },
          {
            workerSessionId: "worker-repair",
            reviewerSessionId: "review-repair",
          },
          { reviewerSessionId: "review-recheck", reviewOnly: true },
        ],
      } as HostTask),
    ).toEqual({ worker: "worker-repair", review: "review-recheck" });
  });

  it("retains takeover and legacy note session links without producing blank targets", () => {
    expect(
      taskSessionIds({
        status: "blocked",
        sessionId: " ",
        blockedTakeover: { previousSessionId: "worker-takeover" },
        reviewNotes: [
          { updatedAt: 1, sessionId: "review-older" },
          { updatedAt: 2, sessionIds: ["review-a", "review-latest"] },
        ],
      } as HostTask),
    ).toEqual({ worker: "worker-takeover", review: "review-latest" });
    expect(taskSessionIds({ status: "todo" } as HostTask)).toEqual({
      worker: undefined,
      review: undefined,
    });
  });

  it("preserves the selected remote host and registered project binding", () => {
    expect(
      taskBackgroundSessionTarget(
        {
          machineId: "mac",
          cwd: "remote://env-mac/work/project",
          projectId: "project-mac",
        },
        "worker-task",
      ),
    ).toEqual({
      machineId: "mac",
      cwd: "remote://env-mac/work/project",
      projectId: "project-mac",
      sessionId: "worker-task",
    });
    expect(() =>
      taskBackgroundSessionTarget(
        {
          machineId: "local",
          cwd: "/work/project",
          projectId: "project-local",
        },
        " ",
      ),
    ).toThrow("This session is no longer available.");
  });
});
