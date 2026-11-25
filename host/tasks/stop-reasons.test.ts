import { expect, it } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { stopFitsStatus, waitFitsStatus } from "../../src/shared/model/host-contracts/task-stop";
import { buildTaskStop } from "../../src/shared/model/host-contracts/task-stop";
import type { TaskContext } from "./context";
import { runOutcomeStop } from "./stop-reasons";

/** Type-level: a block needs a stop code, so a bare message no longer compiles. */
export function blockNeedsACode(context: TaskContext, task: HostTask) {
  // @ts-expect-error a message alone is not a reason
  void context.block(task, "Stopped by you.", 1);
  // @ts-expect-error the object form needs its code
  void context.block(task, { message: "Stopped." }, 1);
  void context.block(task, { code: "owner_stopped", message: "Stopped." }, 1);
}

const task = { status: "running" } as HostTask;

it("reads a run's cause, never its message, to name why it stopped", () => {
  expect(runOutcomeStop(task, { status: "cancelled" }, "worker")).toMatchObject({
    code: "owner_stopped",
  });
  expect(
    runOutcomeStop(task, { status: "failed", cause: "host_interrupted", error: "x" }, "worker"),
  ).toMatchObject({ code: "host_interrupted" });
  expect(
    runOutcomeStop(
      task,
      { status: "failed", cause: "owner_gate", error: "Not signed in" },
      "worker",
    ),
  ).toMatchObject({ code: "permission_required", nextAction: "retry" });
  expect(
    runOutcomeStop(task, { status: "failed", error: "Not signed in." }, "worker"),
  ).toMatchObject({
    code: "run_failed",
  });
  const limited = { ...task, stop: buildTaskStop({ code: "budget_exhausted", message: "x" }, 1) };
  expect(runOutcomeStop(limited, { status: "failed", error: "x" }, "worker")).toMatchObject({
    code: "budget_exhausted",
  });
});

it("keeps a stop only where one belongs, and a wait only while queued", () => {
  const stop = buildTaskStop({ code: "run_failed", message: "x" }, 1);
  expect(stopFitsStatus({ status: "blocked", stop })).toBe(true);
  expect(stopFitsStatus({ status: "running", stop })).toBe(false);
  expect(stopFitsStatus({ status: "done", stop })).toBe(false);
  const asking = buildTaskStop({ code: "input_required", message: "x" }, 1);
  expect(stopFitsStatus({ status: "running", stop: asking })).toBe(true);
  const wait = { code: "dependency" as const, message: "x" };
  expect(waitFitsStatus({ status: "queued", wait })).toBe(true);
  expect(waitFitsStatus({ status: "blocked", wait })).toBe(false);
  expect(
    waitFitsStatus({ status: "running", wait: { code: "usage_limit" as const, message: "x" } }),
  ).toBe(true);
});
