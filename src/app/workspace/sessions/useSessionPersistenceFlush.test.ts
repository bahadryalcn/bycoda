// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionPersistenceFlush } from "./useSessionPersistenceFlush";
import type { ToolWindow } from "../../model/toolWindows";

const close = vi.hoisted(() => ({
  listen:
    vi.fn<(handler: (event: { preventDefault: () => void }) => void) => Promise<() => void>>(),
  destroy: vi.fn().mockResolvedValue(undefined),
  hide: vi.fn().mockResolvedValue(undefined),
  persistLive: vi.fn().mockResolvedValue(undefined),
  busy: vi.fn(),
  mac: false,
  windows: true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: close.listen }),
}));
vi.mock("../../../platform/tauri/platform", () => ({
  get IS_MAC() {
    return close.mac;
  },
  get IS_WIN() {
    return close.windows;
  },
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({ sessionsRef: { current: [] } }));
vi.mock("../../model/appLifecycle", () => ({
  closeBusyWindow: close.destroy,
  hasInFlightSessions: close.busy,
  hideCurrentWindow: close.hide,
  persistLiveTranscripts: close.persistLive,
  setQuitWorkspace: () => () => undefined,
}));

function Probe({ toolWindow }: { toolWindow: ToolWindow | null }) {
  useSessionPersistenceFlush({
    tabsRef: { current: [] },
    activeTabIdRef: { current: "" },
    projectCwdRef: { current: "" },
    projectTerminalsRef: { current: [] },
    lastDockSideRef: { current: null },
    readProjectReturnMemory: () => new Map(),
    flushHarnessEvents: () => undefined,
    keepWorkspaceTab: () => true,
    windowTransfer: null,
    toolWindow,
  });
  return null;
}

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  close.listen.mockResolvedValue(() => undefined);
  close.mac = false;
  close.windows = true;
  close.busy.mockReturnValue(false);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function requestClose(toolWindow: ToolWindow | null = null) {
  await act(async () => root.render(createElement(Probe, { toolWindow })));
  const preventDefault = vi.fn();
  const handler = close.listen.mock.calls[0]?.[0];
  expect(handler).toBeDefined();
  await act(async () => handler?.({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
}

it.each([false, true])("routes Windows workspaces through safe close (busy=%s)", async (busy) => {
  close.busy.mockReturnValue(busy);
  await requestClose();
  expect(close.destroy).toHaveBeenCalledOnce();
  expect(close.hide).not.toHaveBeenCalled();
});

it("routes a busy Windows tool workspace through safe close", async () => {
  close.busy.mockReturnValue(true);
  await requestClose({ active: "terminal", cwd: "~", grouped: false });
  expect(close.destroy).toHaveBeenCalledOnce();
  expect(close.hide).not.toHaveBeenCalled();
});

it("keeps an active macOS workspace running when its window is closed", async () => {
  close.mac = true;
  close.windows = false;
  close.busy.mockReturnValue(true);
  await requestClose();
  expect(close.hide).toHaveBeenCalledOnce();
  expect(close.persistLive).toHaveBeenCalledOnce();
  expect(close.destroy).not.toHaveBeenCalled();
});
