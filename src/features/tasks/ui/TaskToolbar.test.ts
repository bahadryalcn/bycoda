// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { sprintProjectKey } from "../model/hostSprints";
import { normalizeTaskSection, projectScopeOptions, TaskCreationSplit } from "./TaskToolbar";
import { button, isDisabled } from "./tasksViewTestKit";

const scope = (environmentId: string, projectId: string, name: string) => ({
  key: sprintProjectKey({ environmentId, projectId }),
  name,
  machineName: "Laptop",
  cwd: `/work/${name}`,
});
const alpha = scope("env", "a", "alpha");
const beta = scope("env", "b", "beta");
const t = (key: string) => key;

it("maps a retained Reports tab to Sprints before rendering", () => {
  expect(normalizeTaskSection("reports")).toBe("sprints");
  expect(normalizeTaskSection("sprints")).toBe("sprints");
  expect(normalizeTaskSection("backlog")).toBe("backlog");
});

it("independently gates the task and epic actions of the split button", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const choices: string[] = [];
  const render = (disabled: boolean) =>
    act(async () =>
      root.render(
        createElement(TaskCreationSplit, {
          create: { visible: true, disabled, onCreate: () => choices.push("task") },
          epic: { disabled: !disabled, onCreate: () => choices.push("epic") },
        }),
      ),
    );
  try {
    await render(true);
    expect(isDisabled(button(container, "New task")!)).toBe(true);
    await act(async () => button(container, "More creation options")!.click());
    await act(async () => button(document.body, "New epic")!.click());
    expect(choices).toEqual(["epic"]);
    await render(false);
    expect(isDisabled(button(container, "More creation options")!)).toBe(true);
    await act(async () => button(container, "New task")!.click());
    expect(choices).toEqual(["epic", "task"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

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
