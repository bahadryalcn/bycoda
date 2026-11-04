// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  listen: vi.fn(),
  callbacks: new Map<string, (event: { payload: unknown }) => void>(),
  targets: new Map<string, unknown>(),
  releases: [] as ReturnType<typeof vi.fn>[],
  run: vi.fn((_name: string, action: () => void) => action()),
  onNew: vi.fn(),
  onClosePane: vi.fn(),
  onOpenApprovalSession: vi.fn(),
  restoreWindowFocus: vi.fn(async () => undefined),
  sessionsRef: { current: [{ id: "session-1" }] },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "workspace-1" }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "workspace-1" }) }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false }));
vi.mock("../../../features/settings/model/uiScale", () => ({
  applyUiScale: vi.fn(async () => undefined),
  loadUiScale: () => 1,
  saveUiScale: vi.fn(),
  UI_SCALE_DEFAULT: 1,
  zoomInUiScale: (value: number) => value,
  zoomOutUiScale: (value: number) => value,
}));
vi.mock("../../../features/settings/model/settings", () => ({ saveAutosave: vi.fn() }));
vi.mock("../../../features/files/editor/editorFindBridge", () => ({
  openFindInActiveEditor: vi.fn(),
}));
vi.mock("../../../features/onboarding/model/usageGuide", () => ({ openUsageGuide: vi.fn() }));
vi.mock("../../../features/notifications/model/notifications", () => ({
  BACKGROUND_NOTIFICATION_TARGETS: {
    tasks: "tasks",
    automations: "automations",
    summary: "summary",
    assistant: "assistant",
  },
  NOTIFICATION_CLICK_EVENT: "bycoda:notification-click",
}));
vi.mock("../../../features/notifications/hooks/useBackgroundNotifications", () => ({
  isLeadWindow: async () => true,
}));
vi.mock("../../../features/tasks/model/dailySummaryClient", () => ({
  requestSummaryPanel: vi.fn(),
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  sessionsRef: mocks.sessionsRef,
}));
vi.mock("../../model/windowFocus", () => ({ restoreWindowFocus: mocks.restoreWindowFocus }));
vi.mock("../../model/updater", () => ({ runUpdateFlow: vi.fn(async () => undefined) }));

import { useNativeMenuEvents } from "./useNativeMenuEvents";

function Probe() {
  const actions = useRef({
    onNew: mocks.onNew,
    onClosePane: mocks.onClosePane,
    onOpenApprovalSession: mocks.onOpenApprovalSession,
  });
  useNativeMenuEvents({ actions: actions as never, run: mocks.run as never });
  return null;
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.callbacks.clear();
  mocks.targets.clear();
  mocks.releases = [];
  mocks.listen.mockImplementation(async (name: string, callback, options) => {
    mocks.callbacks.set(name, callback);
    mocks.targets.set(name, options);
    const release = vi.fn();
    mocks.releases.push(release);
    return release;
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("subscribes every menu command on this window only and releases all on unmount", async () => {
  await act(async () => root.render(createElement(Probe)));
  // Rust routes menu clicks to the focused window; a process-wide listener ran the
  // command in every open workspace (one click opened N tabs, closed N panes).
  expect(mocks.listen.mock.calls.length).toBeGreaterThan(30);
  for (const [name, options] of mocks.targets) {
    expect(options, `menu event ${name} must be window-scoped`).toEqual({
      target: "workspace-1",
    });
  }
  mocks.callbacks.get("new_tab")!({ payload: null });
  expect(mocks.run).toHaveBeenCalledWith("new", mocks.onNew);
  expect(mocks.onNew).toHaveBeenCalledOnce();
  mocks.callbacks.get("close_tab")!({ payload: null });
  expect(mocks.onClosePane).toHaveBeenCalledOnce();

  // Broadcasts still reach a window-scoped listener; the session owner acts.
  mocks.callbacks.get("bycoda:notification-click")!({ payload: "session-1" });
  expect(mocks.onOpenApprovalSession).toHaveBeenCalledExactlyOnceWith("session-1");
  mocks.callbacks.get("bycoda:notification-click")!({ payload: "elsewhere" });
  expect(mocks.onOpenApprovalSession).toHaveBeenCalledOnce();

  await act(async () => root.unmount());
  expect(mocks.releases.length).toBe(mocks.listen.mock.calls.length);
  expect(mocks.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  root = createRoot(container);
});
