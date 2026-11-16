// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useSkillGroupView } from "./useSkillGroupView";

it("remembers view and the open group across page remounts", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  let state!: ReturnType<typeof useSkillGroupView>;
  function Fixture() {
    state = useSkillGroupView();
    return null;
  }
  let root = createRoot(container);
  try {
    act(() => root.render(createElement(Fixture)));
    expect(state).toMatchObject({ view: "all", groupId: null });
    act(() => state.selectGroup("writing"));
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(Fixture)));
    expect(state).toMatchObject({ view: "groups", groupId: "writing" });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
