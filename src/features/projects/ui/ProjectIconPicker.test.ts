// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProjectIconPicker } from "./ProjectIconPicker";
let root: Root;
let container: HTMLDivElement;
const onPick = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onPick.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(ProjectIconPicker, {
        project: "test",
        name: "shield",
        color: "#a855f7",
        onPick,
      }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const choices = () => [
  ...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Project icon:"]'),
];
it("shows all 32 choices and retains the selected icon", () => {
  expect(
    container.querySelector('svg[data-project-icon="shield"]')?.getAttribute("style"),
  ).toContain("#a855f7");
  expect(choices()).toHaveLength(32);
  expect(
    container.querySelector('[aria-label="Project icon: Security"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Project icon: Coffee / Personal"]')!
      .click(),
  );
  expect(onPick).toHaveBeenCalledWith("coffee");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Use automatic project icon"]')!
      .click(),
  );
  expect(onPick).toHaveBeenLastCalledWith(null);
});
it("filters categories without changing the persisted selection", () => {
  const select = container.querySelector("select")!;
  act(() => {
    select.value = "Creative";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(choices()).toHaveLength(4);
  expect(container.textContent).toContain("Security");
  expect(onPick).not.toHaveBeenCalled();
});
it("searches by Turkish alias and provides a clear empty state", () => {
  const input = container.querySelector("input")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, "cuzdan");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(choices()).toHaveLength(1);
  expect(choices()[0].getAttribute("aria-label")).toBe("Project icon: Wallet / Payments");
  act(() => {
    setValue.call(input, "not-an-icon");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(choices()).toHaveLength(0);
  expect(container.textContent).toContain("No matching icons");
});
