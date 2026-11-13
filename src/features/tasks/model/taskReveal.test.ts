import { expect, it } from "vitest";
import { findRevealedTask, type TaskRevealTarget } from "./taskReveal";
import type { BoardTask } from "./taskClient";
import type { RemoteMachine } from "../../connections/model/protocol";

it("opens only the exact machine environment, project, folder and Task", () => {
  const target: TaskRevealTarget = {
    machineId: "host",
    environmentId: "original",
    projectId: "project",
    cwd: "/work/app",
    taskId: "task",
  };
  const machine = { id: "host", environmentId: "original" } as RemoteMachine;
  const task = {
    machineId: "host",
    projectId: "project",
    cwd: "/work/app",
    id: "task",
  } as BoardTask;
  const decoys = [
    { ...task, machineId: "other" },
    { ...task, projectId: "other" },
    { ...task, cwd: "/other/app" },
    { ...task, id: "other" },
  ];
  expect(findRevealedTask(target, [machine], decoys)).toBeUndefined();
  expect(
    findRevealedTask(target, [{ ...machine, environmentId: "replacement" }], [task]),
  ).toBeUndefined();
  expect(findRevealedTask(target, [machine], [...decoys, task])).toBe(task);
});
