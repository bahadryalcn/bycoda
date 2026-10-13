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
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: api.invoke,
  isTauri: () => api.native,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    api.callbacks.set(name, callback);
    const release = vi.fn();
    api.releases.push(release);
    return release;
  }),
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

it("leaves Windows and browser sessions alone", async () => {
  api.mac = false;
  await act(async () => root.render(createElement(Probe)));
  expect(api.invoke).not.toHaveBeenCalled();
  expect(api.callbacks.size).toBe(0);
  api.mac = true;
  api.native = false;
  await act(async () => root.render(createElement(Probe)));
  expect(api.invoke).not.toHaveBeenCalled();
  expect(api.callbacks.size).toBe(0);
});
