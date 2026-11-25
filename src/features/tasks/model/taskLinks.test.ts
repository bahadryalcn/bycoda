import { describe, expect, it } from "vitest";
import type { RemoteMachine } from "../../connections";
import { taskAutomationTarget, taskCrewRunTarget } from "./taskLinks";

const local = {
  id: "local",
  name: "This computer (local sync)",
  endpoint: "http://127.0.0.1:4000",
  environmentId: "env-local",
  localHost: true,
} as unknown as RemoteMachine;
const remote = {
  id: "far",
  name: "Far",
  endpoint: "https://far.example",
  environmentId: "env-far",
} as unknown as RemoteMachine;

describe("task links", () => {
  it("names the automation of the exact Host that ran the task", () => {
    const task = {
      automationId: "a1",
      origin: { kind: "automation" as const },
      projectId: "p1",
      machineId: "far",
    };
    expect(taskAutomationTarget(task, [local, remote])).toEqual({
      id: "a1",
      projectId: "p1",
      environmentId: "env-far",
      machineId: "far",
    });
    expect(taskAutomationTarget(task, [local])).toBeUndefined();
    expect(taskAutomationTarget({ ...task, automationId: undefined }, [remote])).toBeUndefined();
    expect(
      taskAutomationTarget({ ...task, origin: { kind: "board" as const } }, [remote]),
    ).toBeUndefined();
  });

  it("lands the Crews page on the run, only for this computer's Host", () => {
    const task = {
      crewRunId: "run-1",
      executor: { kind: "crew" as const, crewDefinitionId: "crew-1" },
      machineId: "local",
    };
    expect(taskCrewRunTarget(task, [local, remote])).toEqual({
      tab: "work",
      runId: "run-1",
      definitionId: "crew-1",
    });
    expect(taskCrewRunTarget({ ...task, machineId: "far" }, [local, remote])).toBeUndefined();
    expect(taskCrewRunTarget({ ...task, crewRunId: undefined }, [local])).toBeUndefined();
  });
});
