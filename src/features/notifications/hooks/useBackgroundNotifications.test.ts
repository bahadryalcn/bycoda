// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  windows: vi.fn(),
  current: vi.fn(),
  tasks: vi.fn(),
  notify: vi.fn(),
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
  loadNotificationsEnabled: () => true,
  notifyBackground: mocks.notify,
}));
import {
  isLeadWindow,
  isWorkspaceWindowLabel,
  useBackgroundNotifications,
} from "./useBackgroundNotifications";
let root: Root | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses a single main-window fallback and never elects an unidentified window", async () => {
  mocks.windows.mockRejectedValue(new Error("Enumeration unavailable"));
  mocks.current
    .mockReturnValueOnce({ label: "main" })
    .mockReturnValueOnce({ label: "window-2" })
    .mockReturnValueOnce({ label: "quick-composer" });
  expect(await Promise.all([isLeadWindow(), isLeadWindow(), isLeadWindow()])).toEqual([
    true,
    false,
    false,
  ]);
  mocks.current.mockImplementationOnce(() => {
    throw new Error("Window unavailable");
  });
  expect(await isLeadWindow()).toBe(false);
});

it("preserves normal window election and excludes quick composers", async () => {
  mocks.windows.mockResolvedValue([
    { label: "window-2" },
    { label: "quick-composer" },
    { label: "quick-composer-git" },
    { label: "main" },
  ]);
  mocks.current.mockReturnValueOnce({ label: "main" }).mockReturnValueOnce({ label: "window-2" });
  expect(await Promise.all([isLeadWindow(), isLeadWindow()])).toEqual([true, false]);
});

it("elects a workspace window although the hidden indicator window sorts first", async () => {
  // The desktop-control indicator is created at launch in every build, so an
  // election over every label never picked a workspace window at all.
  mocks.windows.mockResolvedValue([
    { label: "desktop-control-indicator" },
    { label: "main" },
    { label: "window-3" },
  ]);
  mocks.current
    .mockReturnValueOnce({ label: "main" })
    .mockReturnValueOnce({ label: "window-3" })
    .mockReturnValueOnce({ label: "desktop-control-indicator" });
  expect(await Promise.all([isLeadWindow(), isLeadWindow(), isLeadWindow()])).toEqual([
    true,
    false,
    false,
  ]);
});

it("ignores voice overlays, quick composers and other helper windows", async () => {
  mocks.windows.mockResolvedValue([
    { label: "desktop-control-indicator" },
    { label: "quick-composer" },
    { label: "quick-composer-git" },
    { label: "voice-overlay-main" },
    { label: "voice-overlay-window-4" },
    { label: "tools-helper" },
    { label: "window-4" },
  ]);
  mocks.current
    .mockReturnValueOnce({ label: "window-4" })
    .mockReturnValueOnce({ label: "voice-overlay-main" })
    .mockReturnValueOnce({ label: "quick-composer" })
    .mockReturnValueOnce({ label: "tools-helper" });
  expect(
    await Promise.all([isLeadWindow(), isLeadWindow(), isLeadWindow(), isLeadWindow()]),
  ).toEqual([true, false, false, false]);
});

it("classifies workspace window labels the way the native layer does", () => {
  for (const label of ["main", "window-1", "window-27", "quick-session-6f1c"])
    expect(isWorkspaceWindowLabel(label)).toBe(true);
  for (const label of [
    "desktop-control-indicator",
    "quick-composer",
    "quick-composer-git",
    "voice-overlay-main",
    "window-",
    "window-x",
    "",
  ])
    expect(isWorkspaceWindowLabel(label)).toBe(false);
});

it("announces a background transition once across two watcher instances while enumeration keeps failing", async () => {
  vi.useFakeTimers();
  mocks.windows.mockRejectedValue(new Error("Enumeration unavailable"));
  let checks = 0;
  mocks.current.mockImplementation(() => ({
    label: checks++ % 2 === 0 ? "main" : "window-2",
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
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.objectContaining({ target: "tasks", kind: "finished" }),
  );
});
