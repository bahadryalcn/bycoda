import { describe, expect, it } from "vitest";
import {
  automationRunStatusOf,
  goalProgress,
  goalStateFromTasks,
  projectAutomationRun,
  projectGoal,
  projectJob,
  projectTask,
} from "./workProjection";
import type { TaskStop, TaskWait } from "./host-contracts/task-stop";

type TaskStatus = "todo" | "queued" | "running" | "verifying" | "review" | "done" | "blocked";

describe("goal progress", () => {
  it("matches array and shared-index results for cross-goal chains and deleted dependencies", () => {
    const all = [
      { id: "blocked", title: "Blocked", status: "blocked" as const },
      { id: "external", title: "External", status: "queued" as const, dependsOn: ["blocked"] },
      { id: "own", title: "Own", status: "queued" as const, dependsOn: ["external"] },
    ];
    const goal = { taskIds: ["blocked", "own", "deleted"] };
    const index = new Map(all.map((task) => [task.id, task]));
    expect(goalStateFromTasks(goal, all)).toEqual({
      status: "blocked",
      error: "1 of 2 tasks blocked: Blocked",
    });
    expect(goalStateFromTasks(goal, index)).toEqual(goalStateFromTasks(goal, all));
    index.delete("external");
    expect(goalStateFromTasks(goal, index)).toEqual({ status: "running" });
    expect(goalStateFromTasks(goal, [...index.values()])).toEqual({ status: "running" });
  });

  const task = (id: string, status: TaskStatus, dependsOn?: string[]) => ({
    id,
    title: `Do ${id}`,
    status,
    ...(dependsOn ? { dependsOn } : {}),
  });
  const state = (...tasks: ReturnType<typeof task>[]) =>
    goalStateFromTasks({ taskIds: tasks.map((entry) => entry.id) }, tasks);

  it("is done when every task is done", () => {
    expect(state(task("a", "done"), task("b", "done"))).toEqual({
      status: "done",
    });
  });

  it("keeps running while anything can still move", () => {
    expect(state(task("a", "running"), task("b", "queued", ["a"]))).toEqual({
      status: "running",
    });
    // An unrelated task still runs beside a blocked one.
    expect(state(task("a", "blocked"), task("b", "running")).status).toBe("running");
    // A task in review waits only for the owner.
    expect(state(task("a", "blocked"), task("b", "review")).status).toBe("running");
    // A queued task whose dependencies are fine can still start.
    expect(state(task("a", "blocked"), task("b", "done"), task("c", "queued", ["b"])).status).toBe(
      "running",
    );
  });

  it("is blocked when every unfinished task waits on a blocked one", () => {
    expect(
      state(
        task("a", "blocked"),
        task("b", "queued", ["a"]),
        task("c", "queued", ["b"]),
        task("d", "done"),
      ),
    ).toEqual({ status: "blocked", error: "1 of 4 tasks blocked: Do a" });
    expect(state(task("a", "blocked"), task("b", "blocked"))).toEqual({
      status: "blocked",
      error: "2 of 2 tasks blocked: Do a, Do b",
    });
  });

  it("counts done tasks, leaving out deleted ones", () => {
    expect(
      goalProgress({ taskIds: ["a", "b", "gone"] }, [task("a", "done"), task("b", "queued")]),
    ).toEqual({ done: 1, total: 2 });
    expect(goalStateFromTasks({ taskIds: ["gone"] }, [])).toMatchObject({
      status: "blocked",
    });
  });
});

const stop = (code: TaskStop["code"], nextAction: TaskStop["nextAction"] = "retry"): TaskStop => ({
  code,
  message: "It failed. More detail.",
  actor: "host",
  nextAction,
  at: 1,
});
const wait = (code: TaskWait["code"]): TaskWait => ({ code, message: "Later." }) as TaskWait;

describe("work projection", () => {
  it("projects every task status to one phase", () => {
    expect(projectTask({ status: "todo" }).phase).toBe("pending");
    expect(projectTask({ status: "queued" }).phase).toBe("pending");
    expect(projectTask({ status: "running" }).phase).toBe("running");
    expect(projectTask({ status: "verifying" }).phase).toBe("running");
    expect(projectTask({ status: "review" }).phase).toBe("review");
    expect(projectTask({ status: "done" }).phase).toBe("done");
  });

  it("separates a stop, an owner stop, a question and a wait", () => {
    const failed = projectTask({ status: "blocked", stop: stop("run_failed") });
    expect(failed.phase).toBe("stopped");
    expect(failed.stop?.title).toBe("Failed");
    expect(failed.wait).toBeUndefined();
    expect(projectTask({ status: "blocked", stop: stop("owner_stopped", "retry") }).phase).toBe(
      "cancelled",
    );
    expect(projectTask({ status: "blocked" }).stop?.code).toBe("unrecorded");
    expect(
      projectTask({ status: "running", stop: stop("input_required", "provide_input") }),
    ).toMatchObject({
      phase: "input",
      stop: { title: "Needs input" },
    });
    const waiting = projectTask({ status: "queued", wait: wait("daily_limit") });
    expect(waiting.phase).toBe("pending");
    expect(waiting.wait?.code).toBe("daily_limit");
    expect(waiting.stop).toBeUndefined();
  });

  it("projects a goal from its status and tasks", () => {
    expect(projectGoal({ status: "planning" }, []).phase).toBe("running");
    expect(projectGoal({ status: "awaiting-approval" }, []).phase).toBe("input");
    expect(projectGoal({ status: "done" }, []).phase).toBe("done");
    expect(projectGoal({ status: "cancelled" }, []).phase).toBe("cancelled");
    expect(
      projectGoal({ status: "running" }, [
        { status: "running", stop: stop("input_required", "provide_input") },
      ]).phase,
    ).toBe("input");
    expect(projectGoal({ status: "running" }, [{ status: "queued" }]).phase).toBe("running");
  });

  it("gives a blocked goal its blocked task's reason, else its own error", () => {
    const blocked = projectGoal({ status: "blocked", error: "1 of 1 task blocked: A" }, [
      { status: "blocked", stop: stop("budget_exhausted", "raise_budget") },
    ]);
    expect(blocked.stop?.code).toBe("budget_exhausted");
    const bare = projectGoal({ status: "blocked", error: "Planner could not run." }, []);
    expect(bare).toMatchObject({
      phase: "stopped",
      stop: { code: "unrecorded", reason: "Planner could not run." },
    });
  });

  it("maps a phase to an automation occurrence status", () => {
    expect(automationRunStatusOf("done")).toBe("succeeded");
    expect(automationRunStatusOf("review")).toBe("running");
    expect(automationRunStatusOf("input")).toBe("running");
    expect(automationRunStatusOf("pending")).toBe("pending");
    expect(automationRunStatusOf("stopped")).toBe("failed");
    expect(automationRunStatusOf("stopped", true)).toBe("cancelled");
    expect(automationRunStatusOf("cancelled")).toBe("cancelled");
  });

  it("gives the same phase and reason for the same task on every reader", () => {
    const task = { status: "blocked", stop: stop("dependency_stopped", "fix_dependency") };
    const first = projectTask(task);
    const second = projectTask({ ...task });
    expect(second).toEqual(first);
    expect(first.stop?.action).toBe("Fix or remove the dependency");
  });
});

describe("job and occurrence projections", () => {
  it("maps every Room job status to one phase", () => {
    const phase = (status: Parameters<typeof projectJob>[0]["status"]) =>
      projectJob({ status }).phase;
    expect(
      (
        [
          "queued",
          "planning",
          "running",
          "stalled",
          "waiting",
          "done",
          "failed",
          "paused",
          "cancelled",
        ] as const
      ).map(phase),
    ).toEqual([
      "pending",
      "running",
      "running",
      "running",
      "input",
      "done",
      "stopped",
      "pending",
      "cancelled",
    ]);
  });

  it("gives a failed job its reason and a held job its wait", () => {
    expect(projectJob({ status: "failed", error: "Quota ran out. Retry." }).stop).toMatchObject({
      reason: "Quota ran out.",
      tone: "danger",
    });
    expect(projectJob({ status: "paused" }).wait?.code).toBe("assistant_hold");
  });

  it("projects an occurrence that started no task", () => {
    expect(projectAutomationRun({ status: "pending" }).phase).toBe("pending");
    expect(projectAutomationRun({ status: "running" }).phase).toBe("running");
    expect(projectAutomationRun({ status: "running", needsInput: true }).phase).toBe("input");
    expect(projectAutomationRun({ status: "succeeded" }).phase).toBe("done");
    expect(projectAutomationRun({ status: "skipped" }).phase).toBe("cancelled");
    expect(projectAutomationRun({ status: "failed", error: "Host restarted." })).toMatchObject({
      phase: "stopped",
      stop: { reason: "Host restarted." },
    });
  });
});
