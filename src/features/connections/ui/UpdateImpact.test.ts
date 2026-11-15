// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readUpdateImpact } from "../model/updateImpact";
import { UpdateImpact } from "./UpdateImpact";

vi.mock("../model/updateImpact", () => ({ readUpdateImpact: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(readUpdateImpact).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("refreshes activity and removes stale counts after an unsuccessful refresh", async () => {
  vi.mocked(readUpdateImpact)
    .mockResolvedValueOnce([
      { id: "one", name: "Work PC", local: true, affected: true, running: 3, desktopRunning: 2 },
    ])
    .mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => root.render(createElement(UpdateImpact, { target: "app" })));
  expect(container.textContent).toContain("Work PC");
  expect(container.textContent).toContain("Sessions that may be interrupted: 2.");
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(container.textContent).toContain("Machine activity could not be checked.");
  expect(container.textContent).toContain("Unverified activity may also be interrupted.");
  expect(container.textContent).not.toContain("Sessions that may be interrupted: 2.");
  expect(container.textContent).not.toContain("Work PC");
});

it("keeps loading activity uncertain and releases polling when the preview closes", async () => {
  let resolve!: (rows: Awaited<ReturnType<typeof readUpdateImpact>>) => void;
  vi.mocked(readUpdateImpact).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(createElement(UpdateImpact, { target: "local-host" })));
  expect(container.textContent).toContain("Checking machine activity…");
  expect(container.textContent).toContain("Unverified activity may also be interrupted.");
  await act(async () => root.render(null));
  resolve([]);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(readUpdateImpact).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not attribute unknown activity on an unaffected Host to a Host-only update", async () => {
  vi.mocked(readUpdateImpact).mockResolvedValue([
    { id: "local", name: "Work PC", local: true, affected: true, running: 1, desktopRunning: 0 },
    {
      id: "offline",
      name: "Offline PC",
      local: false,
      affected: false,
      running: null,
      desktopRunning: null,
    },
  ]);
  await act(async () => root.render(createElement(UpdateImpact, { target: "local-host" })));
  expect(container.textContent).toContain("Unknown");
  expect(container.textContent).toContain("Sessions that may be interrupted: 1.");
  expect(container.textContent).not.toContain("Unverified activity may also be interrupted.");
});
