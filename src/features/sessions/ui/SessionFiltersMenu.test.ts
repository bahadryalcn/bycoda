// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  type SessionSidebarFilters,
} from "../model/sessionFilters";
import { SessionFiltersMenu } from "./SessionFiltersMenu";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("limits global time choices and clears back to seven days", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const defaults: SessionSidebarFilters = {
    ...DEFAULT_SESSION_SIDEBAR_FILTERS,
    time: "7d",
  };
  function Fixture() {
    const [filters, setFilters] = useState(defaults);
    return createElement(SessionFiltersMenu, {
      x: 0,
      y: 0,
      harnesses: [],
      local: false,
      filters,
      onChange: setFilters,
      onClose: () => {},
      allowedTimeFilters: ["today", "7d"],
      defaultFilters: defaults,
    });
  }
  await act(async () => root.render(createElement(Fixture)));
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === label,
    );
  expect(button("All time")).toBeUndefined();
  expect(button("Last 30 days")).toBeUndefined();
  expect(button("Last 7 days")?.getAttribute("aria-checked")).toBe("true");
  expect(button("Clear filters")).toBeUndefined();
  await act(async () => button("Today")!.click());
  expect(button("Today")?.getAttribute("aria-checked")).toBe("true");
  await act(async () => button("Clear filters")!.click());
  expect(button("Last 7 days")?.getAttribute("aria-checked")).toBe("true");
  expect(button("Clear filters")).toBeUndefined();
  await act(async () => root.unmount());
});

it("offers the Settled filter only for this computer's sessions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const render = (settled: boolean) =>
    root.render(
      createElement(SessionFiltersMenu, {
        x: 0,
        y: 0,
        harnesses: [],
        local: false,
        settled,
        filters: DEFAULT_SESSION_SIDEBAR_FILTERS,
        onChange,
        onClose: () => {},
      }),
    );
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === label,
    );
  await act(async () => render(false));
  expect(button("Settled")).toBeUndefined();
  await act(async () => render(true));
  await act(async () => button("Settled")!.click());
  expect(onChange).toHaveBeenCalledWith({
    ...DEFAULT_SESSION_SIDEBAR_FILTERS,
    showSettled: true,
  });
  await act(async () => root.unmount());
});
