// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { sprintProjectKey } from "../model/hostSprints";
import { projectScopeOptions } from "./TaskToolbar";

const scope = (environmentId: string, projectId: string, name: string) => ({
  key: sprintProjectKey({ environmentId, projectId }),
  name,
  machineName: "Laptop",
  cwd: `/work/${name}`,
});
const alpha = scope("env", "a", "alpha");
const beta = scope("env", "b", "beta");
const t = (key: string) => key;

it("lists every project after All projects", () => {
  const options = projectScopeOptions({
    t,
    projectFilter: "all",
    selectedProject: undefined,
    projectScopes: [alpha, beta],
    currentSprint: undefined,
    cwd: undefined,
  });
  expect(options.map((option) => option.label)).toEqual([
    "All projects",
    "alpha · Laptop",
    "beta · Laptop",
  ]);
});

it("limits the list to the projects of the current sprint", () => {
  const options = projectScopeOptions({
    t,
    projectFilter: "all",
    selectedProject: undefined,
    projectScopes: [alpha, beta],
    currentSprint: { projects: [{ environmentId: "env", projectId: "b" }] },
    cwd: undefined,
  });
  expect(options.map((option) => option.value)).toEqual(["all", beta.key]);
});

it("keeps a path scope selectable before and after its project is known", () => {
  const unknown = projectScopeOptions({
    t,
    projectFilter: "path:/work/alpha",
    selectedProject: undefined,
    projectScopes: [],
    currentSprint: undefined,
    cwd: "/work/alpha",
  });
  expect(unknown[1]).toEqual({ value: "path:/work/alpha", label: "alpha" });
  const known = projectScopeOptions({
    t,
    projectFilter: "path:/work/alpha",
    selectedProject: alpha,
    projectScopes: [alpha],
    currentSprint: undefined,
    cwd: "/work/alpha",
  });
  expect(known.map((option) => option.value)).toEqual(["all", alpha.key, "path:/work/alpha"]);
});
