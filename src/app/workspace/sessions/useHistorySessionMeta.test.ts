// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { useHistorySessionMeta, type HistorySessionMetaDeps } from "./useHistorySessionMeta";

const storage = vi.hoisted(() => ({ pin: vi.fn(), save: vi.fn(), message: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: storage.message }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  setSessionPinned: storage.pin,
  upsertSession: storage.save,
  shouldPersistSession: () => true,
  setSessionLinkedWorkItem: vi.fn(),
}));
let root: Root;
let deps: HistorySessionMetaDeps;
let actions: ReturnType<typeof useHistorySessionMeta>;
const session = { ...newSession("claude", "/repo"), id: "one" };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.pin.mockReset().mockResolvedValue(undefined);
  storage.save.mockReset().mockResolvedValue({ id: session.id });
  storage.message.mockReset().mockResolvedValue(undefined);
  deps = {
    sessionsRef: { current: [] },
    setSessions: vi.fn(),
    history: ["one", "two"].map((id) => ({
      id,
      cwd: "/repo",
      harness: "claude",
      model: "",
      runtimeMode: "auto",
      title: id,
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
    })),
    setHistory: (update) => {
      deps.history = typeof update === "function" ? update(deps.history) : update;
    },
    setStoredLinkedSessions: vi.fn(),
    loadedSessionCache: { current: new Map() },
    invalidateLoadedSession: vi.fn(),
    setLinkedWorkItemPanels: vi.fn(),
    refreshHistory: vi.fn(async () => undefined),
    sidebarCwd: "/repo",
  };
  function Harness() {
    actions = useHistorySessionMeta(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each([true, false])(
  "keeps the previous pin state when saving pinned=%s fails and permits retry",
  async (pinned) => {
    deps.history[0] = { ...deps.history[0], pinned: !pinned };
    storage.pin.mockRejectedValueOnce(new Error("Disk unavailable"));
    await actions.onPinHistorySession("one", pinned);
    expect(deps.history.find((entry) => entry.id === "one")?.pinned).toBe(!pinned);
    expect(storage.message).toHaveBeenCalledWith(
      expect.stringContaining("Disk unavailable"),
      expect.objectContaining({ kind: "error" }),
    );
    await actions.onPinHistorySession("one", pinned);
    expect(deps.history.find((entry) => entry.id === "one")?.pinned).toBe(pinned);
  },
);

it("retains successful bulk pins while failed IDs remain available for retry", async () => {
  storage.pin.mockImplementation(async (id: string) => {
    if (id === "two") throw new Error("Disk unavailable");
  });
  await actions.onPinHistorySessions(["one", "two"], true);
  expect(deps.history.find((entry) => entry.id === "one")?.pinned).toBe(true);
  expect(deps.history.find((entry) => entry.id === "two")?.pinned).toBe(false);
  expect(storage.message).toHaveBeenCalledOnce();
});

it("does not pin an open session whose required initial persistence fails", async () => {
  deps.sessionsRef.current = [session];
  storage.save.mockRejectedValueOnce(new Error("Disk unavailable"));
  await actions.onPinHistorySession("one", true);
  expect(storage.pin).not.toHaveBeenCalled();
  expect(deps.history[0].pinned).toBe(false);
  expect(storage.message).toHaveBeenCalledOnce();
});
