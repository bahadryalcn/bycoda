import { expect, it, vi } from "vitest";
import type { HostProject, RemoteMachine } from "../../../connections/model/protocol";
import {
  parseWorkspaceValue,
  pickPreferredMachine,
  projectIdForCwd,
  workspaceValue,
} from "./workspaceSelection";

// This computer is identified by its id here; the real check reads the local endpoint.
vi.mock("../../../connections/model/localSync", () => ({
  isLocalSyncMachine: (machine: { id: string }) => machine.id === "local",
}));

const machine = (id: string) =>
  ({ id, name: id, endpoint: "", environmentId: "e" }) as unknown as RemoteMachine;

it("prefers the authority Host, then the saved Host, then this computer, then the first Host", () => {
  const local = machine("local");
  const list = [machine("a"), machine("b"), local];
  expect(pickPreferredMachine(list, "b", "a")?.id).toBe("b");
  expect(pickPreferredMachine(list, undefined, "a")?.id).toBe("a");
  expect(pickPreferredMachine(list, undefined, null)?.id).toBe("local");
  expect(pickPreferredMachine([machine("a"), machine("b")], undefined, "zzz")?.id).toBe("a");
  expect(pickPreferredMachine([], undefined, null)).toBeUndefined();
});

it("finds the project whose folder is the surface's working directory", () => {
  const projects = [
    { id: "p1", name: "One", cwd: "/work/one" },
    { id: "p2", name: "Two", cwd: "/work/two" },
  ] as unknown as HostProject[];
  expect(projectIdForCwd(projects, "/work/two")).toBe("p2");
  expect(projectIdForCwd(projects, "/work/three")).toBeUndefined();
});

it("round-trips a workspace choice through the select value", () => {
  expect(parseWorkspaceValue(workspaceValue("m1", "p1"))).toEqual({
    machineId: "m1",
    projectId: "p1",
  });
  expect(parseWorkspaceValue(workspaceValue("m1"))).toEqual({
    machineId: "m1",
    projectId: undefined,
  });
});
