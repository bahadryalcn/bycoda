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

it("shares one report, one focus read and one native subscription across consumers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const listen = vi.spyOn(window, "addEventListener");
  native.read.mockResolvedValue(report("granted"));
  const root = createRoot(document.createElement("div"));
  const seen: ReturnType<typeof usePermissionStatus>[] = [];
  function Probe({ index }: { index: number }) {
    seen[index] = usePermissionStatus(["microphone"]);
    return null;
  }
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        [0, 1, 2, 3, 4, 5, 6].map((i) => createElement(Probe, { key: i, index: i })),
      ),
    ),
  );
  expect(native.read).toHaveBeenCalledTimes(1);
  expect(listen.mock.calls.filter(([type]) => type === "focus")).toHaveLength(1);
  expect(seen.every((row) => row.entries[0].state === "granted")).toBe(true);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(native.read).toHaveBeenCalledTimes(2);
  // A failed read flips every consumer together and never keeps a stale grant.
  native.read.mockRejectedValue(new Error("command unavailable"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(seen.every((row) => row.failed && row.entries[0].state === "unknown")).toBe(true);
  act(() => root.unmount());
  expect(native.dispose).toHaveBeenCalledOnce();
  listen.mockRestore();
});

it("joins a current focus read but an explicit recheck always reads again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.read.mockResolvedValue(report("denied"));
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof usePermissionStatus>;
  function Probe() {
    current = usePermissionStatus(["microphone"]);
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  const pending: ((value: unknown) => void)[] = [];
  native.read.mockImplementation(() => new Promise((done) => pending.push(done)));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(native.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    void current.refresh();
  });
  expect(native.read).toHaveBeenCalledTimes(3);
  // The older probe started before the recheck must not overwrite its result.
  await act(async () => pending[1](report("granted")));
  await act(async () => pending[0](report("denied")));
  expect(current.entries[0].state).toBe("granted");
  act(() => root.unmount());
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
