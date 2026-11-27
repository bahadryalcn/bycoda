// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  windows: vi.fn(),
  current: vi.fn(),
  tasks: vi.fn(),
  notify: vi.fn(),
  enabled: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getAllWebviewWindows: mocks.windows }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: mocks.current }));
vi.mock("../../automations/model/hostAutomationClient", () => ({
  backgroundMachines: async () => [],
  listHostAutomations: async () => [],
}));
vi.mock("../../tasks/model/taskClient", () => ({ listBoardTasks: mocks.tasks }));
vi.mock("../../tasks/model/goalClient", () => ({ listBoardGoals: async () => [] }));
vi.mock("../model/notifications", () => ({
  loadNotificationsEnabled: mocks.enabled,
  notifyBackground: mocks.notify,
}));
import { isLeadWindow, useBackgroundNotifications } from "./useBackgroundNotifications";
let root: Root | undefined;
function Watcher() {
  useBackgroundNotifications(false);
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps one poll in flight while workspace leadership enumeration is pending", async () => {
  vi.useFakeTimers();
  let resolveWindows!: (windows: { label: string }[]) => void;
  mocks.windows.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveWindows = resolve;
      }),
  );
  mocks.current.mockReturnValue({ label: "main" });
  mocks.tasks.mockResolvedValue([]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  // Inside the poll deadline the pending census holds the gate shut.
  await act(async () => vi.advanceTimersByTimeAsync(40_000));
  expect(mocks.windows).toHaveBeenCalledOnce();
  await act(async () => resolveWindows([{ label: "main" }]));
  expect(mocks.tasks).toHaveBeenCalledOnce();
});

it("abandons a poll that never answers so the next tick still polls", async () => {
  vi.useFakeTimers();
  mocks.windows
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue([{ label: "main" }]);
  mocks.current.mockReturnValue({ label: "main" });
  mocks.tasks.mockResolvedValue([]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mocks.windows).toHaveBeenCalledTimes(2);
  expect(mocks.tasks).toHaveBeenCalledOnce();
});

it("discards the late answer of an abandoned poll and keeps the newer baseline", async () => {
  vi.useFakeTimers();
  mocks.windows.mockResolvedValue([{ label: "main" }]);
  mocks.current.mockReturnValue({ label: "main" });
  const task = {
    id: "task",
    machineId: "host",
    machineName: "Host",
    title: "Work",
    status: "running",
  };
  let resolveLate!: (tasks: unknown[]) => void;
  mocks.tasks
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    )
    .mockResolvedValue([task]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  // The first poll passes its deadline; the 60 s tick records the baseline.
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mocks.tasks).toHaveBeenCalledTimes(2);
  // Its late answer neither notifies nor replaces the baseline.
  await act(async () => resolveLate([{ ...task, status: "review" }]));
  expect(mocks.notify).not.toHaveBeenCalled();
  mocks.tasks.mockResolvedValue([{ ...task, status: "review" }]);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.objectContaining({ target: "tasks", kind: "finished" }),
  );
});

it("does not start background reads when leadership resolves after unmount", async () => {
  let resolveWindows!: (windows: { label: string }[]) => void;
  mocks.windows.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveWindows = resolve;
      }),
  );
  mocks.current.mockReturnValue({ label: "main" });
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => resolveWindows([{ label: "main" }]));
  expect(mocks.tasks).not.toHaveBeenCalled();
});

it("does not start reads if notifications turn off during leadership enumeration", async () => {
  let resolveWindows!: (windows: { label: string }[]) => void;
  mocks.windows.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveWindows = resolve;
      }),
  );
  mocks.current.mockReturnValue({ label: "main" });
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  mocks.enabled.mockReturnValue(false);
  await act(async () => resolveWindows([{ label: "main" }]));
  expect(mocks.tasks).not.toHaveBeenCalled();
});

it("holds every watcher when enumeration is unknown and never elects an unidentified window", async () => {
  mocks.windows.mockRejectedValue(new Error("Enumeration unavailable"));
  mocks.current
    .mockReturnValueOnce({ label: "main" })
    .mockReturnValueOnce({ label: "workspace-secondary" })
    .mockReturnValueOnce({ label: "quick-composer" });
  expect(await Promise.all([isLeadWindow(), isLeadWindow(), isLeadWindow()])).toEqual([
    false,
    false,
    false,
  ]);
  mocks.current.mockImplementationOnce(() => {
    throw new Error("Window unavailable");
  });
  expect(await isLeadWindow()).toBe(false);
});

it("elects workspace windows and excludes every native auxiliary window kind", async () => {
  mocks.windows.mockResolvedValue([
    { label: "workspace-secondary" },
    { label: "quick-composer" },
    { label: "quick-composer-git" },
    { label: "desktop-control-indicator" },
    { label: "voice-overlay-main" },
    { label: "main" },
  ]);
  mocks.current
    .mockReturnValueOnce({ label: "main" })
    .mockReturnValueOnce({ label: "workspace-secondary" })
    .mockReturnValueOnce({ label: "quick-composer" })
    .mockReturnValueOnce({ label: "quick-composer-git" })
    .mockReturnValueOnce({ label: "desktop-control-indicator" })
    .mockReturnValueOnce({ label: "voice-overlay-main" });
  expect(await Promise.all(Array.from({ length: 6 }, () => isLeadWindow()))).toEqual([
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
});

it("matches exact auxiliary labels and never elects an auxiliary on an empty list", async () => {
  mocks.windows.mockResolvedValue([]);
  mocks.current.mockReturnValueOnce({ label: "voice-overlay-main" });
  expect(await isLeadWindow()).toBe(false);
  mocks.windows.mockResolvedValue([{ label: "quick-composer-custom" }, { label: "main" }]);
  mocks.current.mockReturnValueOnce({ label: "main" });
  expect(await isLeadWindow()).toBe(true);
});

it("holds announcements during failed enumeration, then elects one watcher after recovery", async () => {
  vi.useFakeTimers();
  mocks.windows.mockRejectedValue(new Error("Enumeration unavailable"));
  let checks = 0;
  mocks.current.mockImplementation(() => ({
    label: checks++ % 2 === 0 ? "main" : "workspace-secondary",
  }));
  const task = {
    id: "task",
    machineId: "host",
    machineName: "Host",
    title: "Work",
    status: "running",
  };
  mocks.tasks.mockResolvedValue([task]);
  function Watcher() {
    useBackgroundNotifications(false);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root!.render(createElement(Fragment, null, createElement(Watcher), createElement(Watcher))),
  );
  expect(mocks.notify).not.toHaveBeenCalled();
  mocks.tasks.mockResolvedValue([{ ...task, status: "review" }]);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mocks.tasks).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
  mocks.windows.mockResolvedValue([{ label: "main" }, { label: "workspace-secondary" }]);
  mocks.tasks.mockResolvedValue([task]);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  mocks.tasks.mockResolvedValue([{ ...task, status: "review" }]);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.objectContaining({ target: "tasks", kind: "finished" }),
  );
});
