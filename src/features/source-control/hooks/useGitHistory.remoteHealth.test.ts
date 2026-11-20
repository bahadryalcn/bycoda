// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gitHistory, reportRemoteLoad } = vi.hoisted(() => ({
  gitHistory: vi.fn(),
  reportRemoteLoad: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitHistory,
  subscribeGitChanged: () => () => {},
  isGitWatched: () => true,
}));
vi.mock("../../connections/public/remoteHealth", () => ({
  reportRemoteLoad,
  useRemoteLoadFailure: () => null,
}));
vi.mock("../../projects/public/recents", () => ({ isRemoteProjectPath: () => true }));
const machine = vi.hoisted(() => ({
  availability: { available: true, connecting: false } as
    | { available: true; connecting: boolean }
    | { available: false; reason: "offline" },
  listeners: new Set<() => void>(),
}));
vi.mock("../../connections/public/machineAvailability", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    machine.listeners.add(listener);
    return () => machine.listeners.delete(listener);
  };
  return {
    useMachineAvailability: () => useSyncExternalStore(subscribe, () => machine.availability),
  };
});
function setAvailability(next: typeof machine.availability) {
  machine.availability = next;
  machine.listeners.forEach((listener) => listener());
}

import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useGitHistory } from "./useGitHistory";
import { resetGitResourceCache } from "./useGitResource";

const CWD = "remote://machine/project";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetGitResourceCache();
  machine.availability = { available: true, connecting: false };
  gitHistory.mockReset();
  reportRemoteLoad.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function View() {
  useGitHistory(CWD, true, false);
  return null;
}

// A transient failure has no on-screen message. Reporting the message instead of the
// outcome told remote health the machine recovered, which reloaded every git reader,
// which failed again: an endless reload loop that froze the window.
it("reports a failed read that shows no message as a failure", async () => {
  const unreachable = new Error("This project's machine isn't connected on this computer.");
  expect(presentRemoteError(unreachable)).toBeUndefined();
  gitHistory.mockRejectedValue(unreachable);

  await act(async () => root.render(createElement(View)));

  expect(reportRemoteLoad).toHaveBeenCalledWith(CWD, "graph", unreachable);
  expect(reportRemoteLoad.mock.calls.filter((call) => call[2] === undefined)).toEqual([]);
});

it("keeps reporting the failure after the failed resource remounts", async () => {
  const unreachable = new Error("This project's machine isn't connected on this computer.");
  gitHistory.mockRejectedValue(unreachable);

  await act(async () => root.render(createElement(View)));
  await act(async () => root.render(null));
  reportRemoteLoad.mockReset();
  await act(async () => root.render(createElement(View)));

  expect(reportRemoteLoad.mock.calls.filter((call) => call[2] === undefined)).toEqual([]);
});

it("reports a successful read as recovered", async () => {
  gitHistory.mockResolvedValue({ commits: [] });

  await act(async () => root.render(createElement(View)));

  expect(reportRemoteLoad).toHaveBeenLastCalledWith(CWD, "graph", undefined);
});

// The machine went offline while a refresh ran: the paused resource stopped loading with the
// cached success still on it, which reported "recovered" and cleared the outage it was in.
it("reports nothing when the machine becomes unavailable during a refresh", async () => {
  gitHistory.mockResolvedValue({ commits: [] });
  let shown: ReturnType<typeof useGitHistory> | undefined;
  const Probe = () => {
    shown = useGitHistory(CWD, true, false);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  reportRemoteLoad.mockReset();
  gitHistory.mockReturnValue(new Promise(() => {}));

  await act(async () => shown?.refresh());
  await act(async () => setAvailability({ available: false, reason: "offline" }));

  expect(reportRemoteLoad).not.toHaveBeenCalled();
});

it("loads no further history while the machine is unavailable", async () => {
  const commits = Array.from({ length: 200 }, (_, index) => ({ sha: `c${index}` }));
  gitHistory.mockResolvedValue({ commits });
  let shown: ReturnType<typeof useGitHistory> | undefined;
  const Probe = () => {
    shown = useGitHistory(CWD, true, false);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  expect(shown?.hasMore).toBe(true);
  gitHistory.mockClear();

  await act(async () => setAvailability({ available: false, reason: "offline" }));
  await act(async () => shown?.loadMore());

  expect(gitHistory).not.toHaveBeenCalled();
});
