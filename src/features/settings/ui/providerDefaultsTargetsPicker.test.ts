// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DefaultsTargetsPicker } from "./providerDefaultsTargetsPicker";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  vi.unstubAllGlobals();
});

it("keeps the empty-selection Global fallback and supports keyboard selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(DefaultsTargetsPicker, {
        values: ["global"],
        onChange,
        options: [
          { value: "global", label: "Global" },
          { value: "project:alpha", label: "Alpha", group: "Projects" },
        ],
      }),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Save in"]')!.click(),
  );
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search projects, groups and workspaces"]',
  )!;
  expect(search.getAttribute("aria-controls")).toBeTruthy();
  const global = document.querySelector<HTMLButtonElement>(
    '[role="option"][aria-selected="true"]',
  )!;
  await act(async () => global.click());
  expect(onChange).toHaveBeenLastCalledWith(["global"]);
  await act(async () => {
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(onChange).toHaveBeenLastCalledWith(["global", "project:alpha"]);
  expect(document.querySelector('[role="dialog"][aria-label="Apply defaults to"]')).not.toBeNull();
});
