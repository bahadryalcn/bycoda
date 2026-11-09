import { describe, expect, it } from "vitest";
import { initialTaskProjectScope, taskMatchesProject, taskProjectIdentity } from "./taskBoardScope";
import type { RemoteMachine } from "../../connections/model/protocol";

const machines = [
  { id: "windows", environmentId: "env-a" },
  { id: "mac", environmentId: "env-b" },
] as RemoteMachine[];
describe("task board project scope", () => {
  it("opens a project without including other projects and respects Windows path spelling", () => {
    const scope = initialTaskProjectScope("G:\\Work\\A\\");
    expect(
      taskMatchesProject(
        { machineId: "windows", projectId: "a", cwd: "g:/work/a" },
        scope,
        machines,
      ),
    ).toBe(true);
    expect(
      taskMatchesProject(
        { machineId: "windows", projectId: "b", cwd: "G:/Work/B" },
        scope,
        machines,
      ),
    ).toBe(false);
    expect(initialTaskProjectScope()).toBe("all");
  });
  it("separates duplicate project IDs on different environments", () => {
    const scope = taskProjectIdentity("env-a", "same");
    expect(
      taskMatchesProject(
        { machineId: "windows", projectId: "same", cwd: "/project" },
        scope,
        machines,
      ),
    ).toBe(true);
    expect(
      taskMatchesProject({ machineId: "mac", projectId: "same", cwd: "/project" }, scope, machines),
    ).toBe(false);
  });
  it("does not invent identity for an unavailable machine", () => {
    expect(
      taskMatchesProject(
        { machineId: "missing", projectId: "same", cwd: "/project" },
        taskProjectIdentity("env-a", "same"),
        machines,
      ),
    ).toBe(false);
  });
});
