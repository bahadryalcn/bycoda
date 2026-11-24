// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { JsonFileView } from "./JsonFileView";
import { LogFileView } from "./LogFileView";

function mount(element: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it("shows a JSON object as a tree", () => {
  const view = mount(
    createElement(JsonFileView, { text: '{"name":"x","n":1}', visible: true, onShowRaw: () => {} }),
  );
  expect(view.container.querySelector('[role="tree"]')).not.toBeNull();
  view.unmount();
});

it("offers the raw view when the text is not a JSON object or array", () => {
  const onShowRaw = vi.fn();
  const view = mount(createElement(JsonFileView, { text: "{ broken", visible: true, onShowRaw }));
  expect(view.container.querySelector('[role="tree"]')).toBeNull();
  act(() => view.container.querySelector("button")?.click());
  expect(onShowRaw).toHaveBeenCalledOnce();
  view.unmount();
});

it("does not parse while the tree is hidden", () => {
  const view = mount(
    createElement(JsonFileView, { text: '{"a":1}', visible: false, onShowRaw: () => {} }),
  );
  expect(view.container.innerHTML).toBe("");
  view.unmount();
});

it("renders nothing for a hidden log", () => {
  const view = mount(createElement(LogFileView, { text: "a\nb", visible: false }));
  expect(view.container.textContent).toBe("");
  view.unmount();
});
