// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readUpdateImpact } from "../model/updateImpact";
import { getSessions, subscribeSessionCommits } from "../../sessions/public/sessionsStore";
import { UpdateImpact } from "./UpdateImpact";

vi.mock("../model/updateImpact", () => ({ readUpdateImpact: vi.fn() }));
vi.mock("../../sessions/public/sessionsStore", () => ({
  getSessions: vi.fn(),
  subscribeSessionCommits: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(readUpdateImpact).mockReset();
  vi.mocked(getSessions).mockReturnValue([]);
  vi.mocked(subscribeSessionCommits).mockReturnValue(() => {});
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
  expect(container.textContent).toContain("This computer");
  expect(container.textContent).toContain("Sessions that may be interrupted: 2.");
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(container.textContent).not.toContain("Sessions that may be interrupted: 2.");
  expect(container.textContent).not.toContain("This computer");
});

it("shows local desktop work immediately and updates it without waiting for Host reads", async () => {
  const local = { id: "desktop", busy: true } as ReturnType<typeof getSessions>[number];
  vi.mocked(getSessions).mockReturnValue([
    local,
    { ...local, id: "host", continuingElsewhere: true },
  ]);
  vi.mocked(readUpdateImpact).mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(UpdateImpact, { target: "app" })));
  expect(container.textContent).toContain("Sessions that may be interrupted: 1.");
  const listener = vi.mocked(subscribeSessionCommits).mock.lastCall?.[0];
  await act(async () => {
    vi.mocked(getSessions).mockReturnValue([{ ...local, busy: false }]);
    listener?.([local], getSessions(), false);
  });
  expect(container.textContent).not.toContain("may be interrupted");
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
  expect(container.textContent).not.toContain("Unverified activity may also be interrupted.");
  await act(async () => root.render(null));
  resolve([]);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(readUpdateImpact).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps an idle app update compact even if an unaffected Host is unreachable", async () => {
  vi.mocked(readUpdateImpact).mockResolvedValue([
    { id: "local", name: "Work PC", local: true, affected: true, running: 0, desktopRunning: 0 },
    {
      id: "remote",
      name: "Offline PC",
      local: false,
      affected: false,
      running: null,
      desktopRunning: null,
    },
  ]);
  await act(async () => root.render(createElement(UpdateImpact, { target: "app" })));
  expect(container.querySelector("table")).toBeNull();
  expect(container.textContent).not.toContain("may be interrupted");
});

it("shows work on another machine without counting it as interrupted by this app restart", async () => {
  vi.mocked(readUpdateImpact).mockResolvedValue([
    { id: "local", name: "Work PC", local: true, affected: true, running: 0, desktopRunning: 0 },
    {
      id: "remote",
      name: "Studio Mac",
      local: false,
      affected: false,
      running: 2,
      desktopRunning: 2,
    },
  ]);
  await act(async () => root.render(createElement(UpdateImpact, { target: "app" })));
  expect(container.textContent).toContain("Studio Mac");
  expect(container.textContent).not.toContain("may be interrupted");
  expect(container.textContent).not.toContain("may stop");
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
  expect(container.textContent).not.toContain("Offline PC");
  expect(container.textContent).toContain("Sessions that may be interrupted: 1.");
  expect(container.textContent).not.toContain("Unverified activity may also be interrupted.");
});
