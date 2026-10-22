// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useRetainedScroll } from "./useRetainedScroll";
import { resetRetainedState } from "./useRetainedState";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
  resetRetainedState();
});
function List({ scope, ready = true }: { scope: string; ready?: boolean }) {
  return createElement("div", { ref: useRetainedScroll<HTMLDivElement>(scope, { ready }) });
}
async function mount(scope: string, ready = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(createElement(List, { scope, ready })));
  return { root, element: container.firstElementChild as HTMLDivElement };
}
it("restores both axes after remount while keeping remote list scopes separate", async () => {
  const first = await mount("tasks:remote://one/repo");
  first.element.scrollTop = 420;
  first.element.scrollLeft = 180;
  first.element.dispatchEvent(new Event("scroll"));
  await act(() => first.root.render(null));
  const other = await mount("tasks:remote://two/repo");
  expect(other.element.scrollTop).toBe(0);
  expect(other.element.scrollLeft).toBe(0);
  const restored = await mount("tasks:remote://one/repo");
  expect(restored.element.scrollTop).toBe(420);
  expect(restored.element.scrollLeft).toBe(180);
});
it("keeps the saved position while a remounted list waits for data", async () => {
  const first = await mount("inbox:project");
  first.element.scrollTop = 320;
  first.element.dispatchEvent(new Event("scroll"));
  await act(() => first.root.render(null));
  const next = await mount("inbox:project", false);
  next.element.dispatchEvent(new Event("scroll"));
  expect(next.element.scrollTop).toBe(0);
  await act(() => next.root.render(createElement(List, { scope: "inbox:project", ready: true })));
  expect(next.element.scrollTop).toBe(320);
});
