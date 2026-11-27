// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderDefaultsScopeRow } from "./providerDefaultsTargetsPicker";
import type { DefaultsTarget } from "../model/providerDefaultsDraft";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  vi.unstubAllGlobals();
});

const recents = [{ path: "C:/work/alpha", openedAt: 1 }];
const segment = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (node) => node.textContent === label,
  )!;
const pickerDialog = () => document.querySelector('[role="dialog"][aria-label="Project picker"]');

async function render(target: DefaultsTarget, onTargetChange = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () =>
    root.render(createElement(ProviderDefaultsScopeRow, { target, recents, onTargetChange })),
  );
  return onTargetChange;
}

it("opens the project picker on Project and picks one project target", async () => {
  const onTargetChange = await render({ kind: "global" });
  expect(pickerDialog()).toBeNull();
  await act(async () => segment("One project").click());
  expect(pickerDialog()).not.toBeNull();
  expect(onTargetChange).not.toHaveBeenCalled();
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes("alpha"),
  )!;
  await act(async () => option.click());
  expect(onTargetChange).toHaveBeenLastCalledWith("project:C:/work/alpha");
});

it("returns to All projects when the picker closes without a pick", async () => {
  const onTargetChange = await render({ kind: "global" });
  await act(async () => segment("One project").click());
  expect(segment("One project").getAttribute("aria-checked")).toBe("true");
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(pickerDialog()).toBeNull();
  expect(segment("All projects").getAttribute("aria-checked")).toBe("true");
  expect(onTargetChange).not.toHaveBeenCalled();
});

it("switches a project target back to All projects", async () => {
  const onTargetChange = await render({ kind: "project", path: "C:/work/alpha" });
  expect(segment("One project").getAttribute("aria-checked")).toBe("true");
  await act(async () => segment("All projects").click());
  expect(onTargetChange).toHaveBeenLastCalledWith("global");
});
