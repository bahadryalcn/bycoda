import { expect, it } from "vitest";
import type { CrewRunView } from "./crewClient";
import { composerCanAssign, composerDefaultMember, composerTitle } from "./crewComposer";

const agent = (id: string, role: string) => ({ id, name: id, role }) as never;
const run = (status: string) =>
  ({
    status,
    definition: { agents: [agent("s1", "specialist"), agent("lead", "coordinator")] },
  }) as unknown as CrewRunView;

it("defaults to the coordinator", () => {
  expect(composerDefaultMember(run("active"))).toBe("lead");
  expect(composerDefaultMember(run("finished"))).toBe("");
});

it("derives a one-line title from the first line", () => {
  expect(composerTitle("  Fix   the login\nthen deploy")).toBe("Fix the login");
  expect(composerTitle("x".repeat(200)).length).toBeLessThanOrEqual(81);
});

it("offers assigning only to specialists of active work", () => {
  expect(composerCanAssign(run("active"), agent("s1", "specialist"))).toBe(true);
  expect(composerCanAssign(run("active"), agent("lead", "coordinator"))).toBe(false);
  expect(composerCanAssign(run("paused"), agent("s1", "specialist"))).toBe(false);
});
