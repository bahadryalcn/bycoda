// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { RadioGroup } from "./RadioGroup";
import { Slider } from "./Slider";
import { ElasticSlider } from "./ElasticSlider";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function tab(element: Element, shiftKey = false) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
    ),
  );
}
it.each(["a", ""])("Tab treats a radio group as one stop (selected=%s)", async (value) => {
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Fixture",
        onClose: () => {},
        children: createElement(
          "div",
          null,
          createElement(RadioGroup, {
            label: "Choice",
            name: "fixture",
            value,
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          }),
          createElement("button", { id: "after-radio" }, "Continue"),
        ),
      }),
    ),
  );
  const first = document.querySelector<HTMLInputElement>('input[value="a"]')!;
  await act(async () => first.focus());
  await tab(first);
  expect(document.activeElement).toBe(document.querySelector("#after-radio"));
  await tab(document.activeElement!, true);
  expect(document.activeElement).toBe(first);
});
it("includes a native disclosure summary in the modal Tab sequence", async () => {
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Fixture",
        onClose: () => {},
        children: createElement(
          "div",
          null,
          createElement("button", { id: "before-summary" }, "Before"),
          createElement(
            "details",
            null,
            createElement("summary", { id: "advanced-summary" }, "Advanced"),
            createElement("button", { id: "inside-details" }, "Extra settings"),
          ),
          createElement("button", { id: "after-summary" }, "After"),
        ),
      }),
    ),
  );
  const before = document.querySelector<HTMLElement>("#before-summary")!;
  await act(async () => before.focus());
  await tab(before);
  expect(document.activeElement).toBe(document.querySelector("#advanced-summary"));
  await tab(document.activeElement!);
  expect(document.activeElement).toBe(document.querySelector("#after-summary"));
  document.querySelector("details")!.open = true;
  await act(async () => document.querySelector<HTMLElement>("#advanced-summary")!.focus());
  await tab(document.activeElement!);
  expect(document.activeElement).toBe(document.querySelector("#inside-details"));
});
it.each([Slider, ElasticSlider])(
  "invalidates a disabled gesture and allows a new enabled drag (%s)",
  async (Control) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const change = vi.fn(),
      commit = vi.fn();
    const render = async (disabled: boolean) =>
      act(async () =>
        root.render(
          createElement(Control, {
            label: "Opacity",
            defaultValue: 50,
            min: 0,
            max: 100,
            disabled,
            onValueChange: change,
            onValueCommit: commit,
          }),
        ),
      );
    await render(false);
    const thumb = container.querySelector('[role="slider"]')!;
    const pointer = async (type: string, clientX: number) =>
      act(async () =>
        thumb.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            clientX,
            bubbles: true,
          }),
        ),
      );
    await pointer("pointerdown", 50);
    await render(true);
    change.mockClear();
    commit.mockClear();
    await pointer("pointermove", 90);
    await pointer("pointerup", 90);
    expect.soft(change).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    await render(false);
    await pointer("pointermove", 80);
    await pointer("pointerup", 80);
    expect(change).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    await pointer("pointerdown", 50);
    await pointer("pointermove", 80);
    await pointer("pointerup", 80);
    expect(change).toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
  },
);
