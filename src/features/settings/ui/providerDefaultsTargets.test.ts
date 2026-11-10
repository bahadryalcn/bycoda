// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { buildDefaultsTargets } from "./ProviderDefaultsSaveBar";

const groups = [
  { id: "g1", name: "Clients", collapsed: false },
  {
    id: "w1",
    name: "Monorepo",
    collapsed: false,
    workspaceFile: "C:/work/mono.code-workspace",
  },
];

it("orders Global, workspaces, groups, then projects", () => {
  const alpha = "C:/work/alpha";
  const beta = "C:/work/beta";
  const { options } = buildDefaultsTargets(alpha, [{ path: beta } as never], groups, {
    [pathKey(alpha)]: "g1",
  });
  expect(options.map((option) => option.group)).toEqual([
    undefined,
    "Workspaces",
    "Groups",
    "Projects",
    "Projects",
  ]);
  expect(options.map((option) => option.label).slice(1, 3)).toEqual(["Monorepo", "Clients"]);
});

it("names the containing group on a project row and keeps its path searchable", () => {
  const alpha = "C:/work/alpha";
  const beta = "C:/work/beta";
  const { options } = buildDefaultsTargets(alpha, [{ path: beta } as never], groups, {
    [pathKey(alpha)]: "g1",
  });
  const projects = options.filter((option) => option.group === "Projects");
  expect(projects.map((option) => option.meta)).toEqual(["Clients", undefined]);
  expect(projects.map((option) => option.keywords)).toEqual([alpha, beta]);
});
