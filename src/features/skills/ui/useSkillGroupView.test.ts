// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, createElement, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { useSkillGroupView } from "./useSkillGroupView";
import { createSkillGroup, listSkillGroups } from "../index";
import { startSkillDrag, dropSkill } from "./useSkillGroupView";

beforeEach(() => localStorage.clear());
it("moves a skill between groups and drops to ungrouped without losing other memberships", () => {
  const from = createSkillGroup({ name: "From", skillNames: ["one"] });
  const to = createSkillGroup({ name: "To", skillNames: [] });
  const other = createSkillGroup({ name: "Other", skillNames: ["one"] });
  const data = new Map<string, string>();
  const event = {
    dataTransfer: {
      types: ["application/x-bycoda-skill-group"],
      setData: (key: string, value: string) => data.set(key, value),
      getData: (key: string) => data.get(key),
    },
    preventDefault() {},
  } as unknown as DragEvent;
  startSkillDrag(event, "one", from.id);
  dropSkill(event, to.id, new Set(["one"]));
  expect(listSkillGroups().find((group) => group.id === from.id)?.skillNames).toEqual([]);
  expect(listSkillGroups().find((group) => group.id === to.id)?.skillNames).toEqual(["one"]);
  startSkillDrag(event, "one", to.id);
  dropSkill(event, undefined, new Set(["one"]));
  expect(listSkillGroups().find((group) => group.id === to.id)?.skillNames).toEqual([]);
  expect(listSkillGroups().find((group) => group.id === other.id)?.skillNames).toEqual(["one"]);
});

it("remembers view and collapse choices across page remounts", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  let state!: ReturnType<typeof useSkillGroupView>;
  function Fixture() {
    state = useSkillGroupView();
    return null;
  }
  let root = createRoot(container);
  try {
    act(() => root.render(createElement(Fixture)));
    act(() => state.setView("groups"));
    act(() => state.toggle("writing"));
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(Fixture)));
    expect(state.view).toBe("groups");
    expect(state.collapsed).toEqual(["writing"]);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
