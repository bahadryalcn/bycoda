// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Input } from "../input/input";
import { Textarea } from "../textarea/textarea";
import { TagInput } from "../tag-input/tag-input";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const consumers = [
  ["Input", (props: object) => createElement(Input, { label: "Name", ...props }), "input"],
  ["Textarea", (props: object) => createElement(Textarea, { label: "Name", ...props }), "textarea"],
  ["TagInput", (props: object) => createElement(TagInput, { label: "Name", ...props }), "input"],
] as const;

it.each(consumers)(
  "%s describes error before help and produces one alert",
  async (_name, make, selector) => {
    await act(async () => root.render(make({ description: "Help copy", error: "Error copy" })));
    const control = container.querySelector(selector)!;
    const ids = control.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0]!)?.getAttribute("role")).toBe("alert");
    expect(document.getElementById(ids[0]!)?.textContent).toContain("Error copy");
    expect(document.getElementById(ids[1]!)?.textContent).toContain("Help copy");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(control.getAttribute("aria-invalid")).toBe("true");
  },
);

it.each(consumers)("%s renders help alone without an alert", async (_name, make, selector) => {
  await act(async () => root.render(make({ description: "Help copy" })));
  const ids = container.querySelector(selector)!.getAttribute("aria-describedby")!.split(" ");
  expect(ids).toHaveLength(1);
  expect(document.getElementById(ids[0]!)?.textContent).toContain("Help copy");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
