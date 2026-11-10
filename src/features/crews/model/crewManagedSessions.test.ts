import { beforeEach, expect, it } from "vitest";
import {
  crewManagedSession,
  crewManagedSessions,
  isCrewManagedRefusal,
  resetCrewManagedSessions,
  setCrewManagedSource,
} from "./crewManagedSessions";
import type { CrewRunView } from "./crewClient";

const agent = (id: string, role: string, name: string) => ({ id, role, name });
function run(over: Record<string, unknown> = {}): CrewRunView {
  return {
    id: "run-1",
    projectId: "p",
    status: "active",
    coordinatorSessionId: "coord",
    definition: {
      id: "def-1",
      name: "Product Team",
      agents: [
        agent("c", "coordinator", "Lead"),
        agent("s", "specialist", "Dev"),
        agent("r", "reviewer", "Checker"),
      ],
    },
    assignments: [{ id: "a", memberId: "s", taskId: "t1" }],
    tasks: [
      {
        id: "t1",
        title: "Build",
        status: "running",
        sessionId: "worker",
        reviewer: { sessionId: "rev" },
      },
    ],
    ...over,
  } as unknown as CrewRunView;
}

beforeEach(() => resetCrewManagedSessions());

it("maps coordinator, worker and reviewer sessions of a live run", () => {
  const map = crewManagedSessions([run()], "m1");
  expect(map.get("coord")).toMatchObject({
    runId: "run-1",
    definitionId: "def-1",
    crewName: "Product Team",
    role: "coordinator",
    memberName: "Lead",
    machineId: "m1",
  });
  expect(map.get("worker")).toMatchObject({ role: "specialist", memberName: "Dev" });
  expect(map.get("rev")).toMatchObject({ role: "reviewer", memberName: "Checker" });
});

it("keeps paused runs managed and releases finished ones", () => {
  expect(crewManagedSessions([run({ status: "paused" })]).has("coord")).toBe(true);
  expect(crewManagedSessions([run({ status: "finished" })]).size).toBe(0);
});

it("answers lookups across sources and drops a source", () => {
  setCrewManagedSource("a", crewManagedSessions([run()]));
  expect(crewManagedSession("coord")?.crewName).toBe("Product Team");
  expect(crewManagedSession("other")).toBeUndefined();
  setCrewManagedSource("a", undefined);
  expect(crewManagedSession("coord")).toBeUndefined();
});

it("recognizes the Host refusal by code or message", () => {
  expect(
    isCrewManagedRefusal(Object.assign(new Error("no"), { code: "crew_managed_session" })),
  ).toBe(true);
  expect(isCrewManagedRefusal(new Error("rpc failed: crew_managed_session"))).toBe(true);
  expect(isCrewManagedRefusal(new Error("boom"))).toBe(false);
  expect(isCrewManagedRefusal("crew_managed_session")).toBe(true);
});
