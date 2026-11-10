// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useTooltip } from "./Tooltip";

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function Anchor({ onRender }: { onRender: () => void }) {
  onRender();
  const hint = useTooltip({ when: "overflow", label: "Long label" });
  return createElement(
    "div",
    { ...hint.trigger, id: "anchor" },
    createElement("span", { id: "child" }, "child"),
  );
}

async function mount() {
  const onRender = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(Anchor, { onRender })));
  const anchor = host.querySelector<HTMLElement>("#anchor")!;
  anchor.style.overflow = "hidden";
  Object.defineProperty(anchor, "clientWidth", { configurable: true, value: 100 });
  Object.defineProperty(anchor, "scrollWidth", { configurable: true, value: 200 });
  // The overflow observer exists only while the tooltip is open: hover the anchor and wait out the open delay.
  await act(async () => {
    host
      .querySelector("#anchor")!
      .dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });
  onRender.mockClear();
  return { host, onRender };
}

async function flushMutations() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

it("does not re-render an overflow anchor when a descendant's inline style changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { host, onRender } = await mount();
  const child = host.querySelector<HTMLElement>("#child")!;
  child.style.opacity = "0.5";
  await flushMutations();
  child.style.opacity = "1";
  await flushMutations();
  expect(onRender).not.toHaveBeenCalled();
});

it("still re-renders an overflow anchor when a descendant's class or hidden attribute changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { host, onRender } = await mount();
  const child = host.querySelector<HTMLElement>("#child")!;
  child.className = "truncated";
  await flushMutations();
  expect(onRender).toHaveBeenCalled();
  onRender.mockClear();
  child.hidden = true;
  await flushMutations();
  expect(onRender).toHaveBeenCalled();
});
