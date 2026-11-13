// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  read: vi.fn(),
  listener: undefined as undefined | ((report: unknown) => void),
  dispose: vi.fn(),
}));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  systemPermissionsStatus: native.read,
  listenSystemPermissionsChanged: (listener: (report: unknown) => void) => {
    native.listener = listener;
    return native.dispose;
  },
}));
vi.mock("../../../shared/i18n", () => ({ t: (s: string) => s }));
import { usePermissionStatus } from "./usePermissionStatus";
const report = (state: string) => ({
  version: 1,
  platform: "macos",
  signing: "stable",
  elevated: null,
  entries: [{ id: "microphone", state, canRequest: false, canOpenSettings: true }],
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("reads on mount and focus, clears stale grants on error, accepts native changes and disposes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.read.mockResolvedValue(report("granted"));
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof usePermissionStatus>;
  function Probe() {
    current = usePermissionStatus(["microphone"]);
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  expect(current.entries[0].state).toBe("granted");
  native.read.mockRejectedValue(new Error("command unavailable"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(current.entries[0].state).toBe("unknown");
  expect(current.failed).toBe(true);
  await act(async () => native.listener?.(report("denied")));
  expect(current.entries[0].state).toBe("denied");
  act(() => root.unmount());
  expect(native.dispose).toHaveBeenCalledOnce();
});

it("polls only during setup and ignores a late read after a newer event", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  native.read.mockResolvedValue(report("denied"));
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof usePermissionStatus>;
  function Probe({ open }: { open: boolean }) {
    current = usePermissionStatus(["microphone"], open);
    return null;
  }
  await act(async () => root.render(createElement(Probe, { open: false })));
  await act(async () => vi.advanceTimersByTime(2000));
  expect(native.read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(createElement(Probe, { open: true })));
  let resolve!: (value: unknown) => void;
  native.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => native.listener?.(report("granted")));
  await act(async () => resolve(report("denied")));
  expect(current.entries[0].state).toBe("granted");
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
