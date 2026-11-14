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

it("separates Bycoda defaults from project overrides and keeps keyboard selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(DefaultsTargetsPicker, {
        values: ["global"],
        onChange,
        options: [
          { value: "global", label: "Bycoda defaults" },
          { value: "project:alpha", label: "Alpha", group: "Projects" },
        ],
      }),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Save in"]')!.click(),
  );
  expect(
    document.querySelector('input[aria-label="Search projects, groups and workspaces"]'),
  ).toBeNull();
  expect(document.body.textContent).not.toContain("Everything");
  const overrides = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (node) => node.textContent === "Project overrides",
  )!;
  await act(async () => overrides.click());
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search projects, groups and workspaces"]',
  )!;
  expect(search.getAttribute("aria-controls")).toBeTruthy();
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
  expect(onChange).toHaveBeenLastCalledWith(["project:alpha"]);
  const bycoda = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (node) => node.textContent === "Bycoda defaults",
  )!;
  await act(async () => bycoda.click());
  expect(onChange).toHaveBeenLastCalledWith(["global"]);
  expect(
    document.querySelector('input[aria-label="Search projects, groups and workspaces"]'),
  ).toBeNull();
  expect(document.querySelector('[role="dialog"][aria-label="Apply defaults to"]')).not.toBeNull();
});
