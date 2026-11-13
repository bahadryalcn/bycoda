import { expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { crewTaskAdmitted } from "./crew-task-admission";

const run = { id: "crew", projectId: "project", sourceTaskId: "task" };
const task = { id: "task", projectId: "project", crewExecutionId: "crew" } as HostTask;

it("rechecks the original Task's parent Stop before a coordinator turn", async () => {
  let allowed = true;
  const tasks = {
    get: vi.fn(async () => task),
    assistantTaskAdmission: vi.fn(async () => allowed),
  };
  expect(await crewTaskAdmitted(tasks, run)).toBe(true);
  allowed = false;
  expect(await crewTaskAdmitted(tasks, run)).toBe(false);
});

it("rejects a missing, foreign or replaced canonical Task without consulting its grant", async () => {
  const admission = vi.fn(async () => true);
  for (const value of [
    undefined,
    { ...task, projectId: "foreign" },
    { ...task, crewExecutionId: "new-crew" },
  ]) {
    expect(
      await crewTaskAdmitted({ get: async () => value, assistantTaskAdmission: admission }, run),
    ).toBe(false);
  }
  expect(admission).not.toHaveBeenCalled();
});
