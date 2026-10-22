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
import { isLeadWindow, useBackgroundNotifications } from "./useBackgroundNotifications";
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
    .mockReturnValueOnce({ label: "workspace-secondary" })
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
    { label: "workspace-secondary" },
    { label: "quick-composer" },
    { label: "main" },
  ]);
  mocks.current
    .mockReturnValueOnce({ label: "main" })
    .mockReturnValueOnce({ label: "workspace-secondary" });
  expect(await Promise.all([isLeadWindow(), isLeadWindow()])).toEqual([true, false]);
});

it("announces a background transition once across two watcher instances while enumeration keeps failing", async () => {
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
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.objectContaining({ target: "tasks", kind: "finished" }),
  );
});
