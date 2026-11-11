// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  mac: true,
  native: true,
  callbacks: new Map<string, (event: { payload: string }) => void>(),
  releases: [] as ReturnType<typeof vi.fn>[],
  targets: new Map<string, unknown>(),
  gate: null as Promise<void> | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: api.invoke,
  isTauri: () => api.native,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback, options) => {
    api.callbacks.set(name, callback);
    api.targets.set(name, options);
    if (name === "bycoda:tray-open-session" && api.gate) await api.gate;
    const release = vi.fn();
    api.releases.push(release);
    return release;
  }),
  once: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "window-2" }),
}));
vi.mock("../../platform/tauri/platform", () => ({
  get IS_MAC() {
    return api.mac;
  },
  IS_LINUX: false,
  IS_WIN: false,
}));
vi.mock("../../features/sessions/hooks/useRecentSessions", () => ({
  useRecentSessions: () => ({ rows: [] }),
}));
import { useTraySessions, TRAY_OPEN_EVENT } from "./useTraySessions";

const onOpen = vi.fn();
const onSettings = vi.fn();
let projectKeys = new Set(["/project"]);
function Probe() {
  useTraySessions({
    history: [],
    live: [
      {
        id: "local",
        cwd: "/project",
        title: "Run",
        harness: "codex",
        model: "",
        activityAt: 1,
        status: "working",
      },
    ],
    agents: [],
    ownedKeys: { local: "host-id" },
    projectKeys,
    onOpen,
    onSettings,
  });
  return null;
}
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.mac = true;
  api.native = true;
  api.callbacks.clear();
  api.targets.clear();
  api.gate = null;
  api.releases = [];
  projectKeys = new Set(["/project"]);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("publishes status and canonical ownership and routes only visible selections", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(api.invoke).toHaveBeenCalledWith(
    "tray_sessions_update",
    expect.objectContaining({
      labels: expect.objectContaining({
        presence: expect.objectContaining({
          availability: "Availability",
          here: "Here",
          away: "Away",
          dnd: "Do not disturb",
          offline: "Offline",
        }),
      }),
      rows: [
        expect.objectContaining({
          id: "local",
          key: "host-id",
          status: "working",
          owned: true,
        }),
      ],
    }),
  );
  api.callbacks.get(TRAY_OPEN_EVENT)?.({ payload: "local" });
  expect(onOpen).toHaveBeenCalledWith("local");
  onOpen.mockClear();
  projectKeys = new Set();
  await act(async () => root.render(createElement(Probe)));
  api.callbacks.get(TRAY_OPEN_EVENT)?.({ payload: "local" });
  expect(onOpen).not.toHaveBeenCalled();
  expect(api.releases).toHaveLength(2); // No listener churn on status changes.
  api.callbacks.get("bycoda:tray-notifications")?.({ payload: "" });
  expect(onSettings).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(api.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  root = createRoot(container);
});

it("publishes native snapshots on Windows and skips IPC in browsers", async () => {
  api.mac = false;
  await act(async () => root.render(createElement(Probe)));
  expect(api.invoke).toHaveBeenCalledWith("tray_sessions_update", expect.any(Object));
  expect(api.callbacks.size).toBe(2);
  vi.clearAllMocks();
  api.callbacks.clear();
  api.mac = true;
  api.native = false;
  await act(async () => root.render(createElement(Probe)));
  expect(api.invoke).not.toHaveBeenCalled();
  expect(api.callbacks.size).toBe(0);
});

it("registers both tray actions for the receiving window", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(api.targets.get(TRAY_OPEN_EVENT)).toEqual({ target: "window-2" });
  expect(api.targets.get("bycoda:tray-notifications")).toEqual({ target: "window-2" });
});

it("ignores a tray action after unmount before registration resolves", async () => {
  let registered!: () => void;
  api.gate = new Promise<void>((resolve) => {
    registered = resolve;
  });
  await act(async () => root.render(createElement(Probe)));
  await act(async () => root.unmount());
  api.callbacks.get(TRAY_OPEN_EVENT)?.({ payload: "local" });
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => {
    registered();
    await Promise.resolve();
  });
  expect(api.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  root = createRoot(container);
});

it("publishes at most one native menu update per second, ending with the latest", async () => {
  vi.useFakeTimers();
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(api.invoke).toHaveBeenCalledTimes(1);
    projectKeys = new Set();
    await act(async () => root.render(createElement(Probe)));
    projectKeys = new Set(["/project"]);
    await act(async () => root.render(createElement(Probe)));
    projectKeys = new Set();
    await act(async () => root.render(createElement(Probe)));
    expect(api.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.invoke).toHaveBeenCalledTimes(2);
    expect(api.invoke).toHaveBeenLastCalledWith(
      "tray_sessions_update",
      expect.objectContaining({ rows: [] }),
    );
  } finally {
    vi.useRealTimers();
  }
});
