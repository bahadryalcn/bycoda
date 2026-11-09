import { expect, it } from "vitest";
import type { HostProject } from "../../../connections/model/protocol";
import { parseWorkspaceValue, projectIdForCwd, workspaceValue } from "./workspaceSelection";

const projects = [
  { id: "win", name: "Windows", cwd: "C:\\Work\\Brand" },
  { id: "unix", name: "Unix", cwd: "/work/brand" },
] as unknown as HostProject[];

it("matches a project folder regardless of slash style, trailing slash and Windows drive case", () => {
  expect(projectIdForCwd(projects, "c:/work/brand/")).toBe("win");
  expect(projectIdForCwd(projects, "/work/brand/")).toBe("unix");
});

it("keeps Unix folders case-sensitive so different projects are not merged", () => {
  expect(projectIdForCwd(projects, "/Work/Brand")).toBeUndefined();
});

it("returns no project for an empty list", () => {
  expect(projectIdForCwd([], "/work/brand")).toBeUndefined();
});

it("keeps ids with quotes, commas and brackets intact through the select value", () => {
  const machineId = 'm"1,[x]';
  const projectId = 'p|"2"';
  expect(parseWorkspaceValue(workspaceValue(machineId, projectId))).toEqual({
    machineId,
    projectId,
  });
});

it("never lets one computer's id and another's project id produce the same select value", () => {
  expect(workspaceValue("a", "b")).not.toBe(workspaceValue("b", "a"));
  expect(workspaceValue("a")).not.toBe(workspaceValue("a", "a"));
});
