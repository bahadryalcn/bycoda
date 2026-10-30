// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  clearWindowDragPreview,
  paneDropFromPoint,
  titleTabDropFromPoint,
} from "../../../features/workspace/model/paneDrop";
import { collectWindowTransfer, type WindowTransferPayload } from "../../model/windowTransfer";
import {
  dismissWindowTransferNotice,
  getWindowTransferNotice,
  subscribeWindowTransferNotice,
} from "../../model/windowTransferNotice";
import {
  useWindowTransferListener,
  type WindowTransferListenerDeps,
} from "./useWindowTransferListener";

type Handler = (event: { payload: string }) => Promise<void>;

const native = vi.hoisted(() => ({
  handler: undefined as Handler | undefined,
  event: "",
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    // A plain function: the suite's mock reset would strip a vi.fn implementation.
    listen: async (event: string, handler: Handler) => {
      native.event = event;
      native.handler = handler;
      return () => native.unlisten();
    },
  }),
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  persistFingerprint: () => "fingerprint",
}));
vi.mock("../../../features/workspace/model/paneDrop", () => ({
  clearWindowDragPreview: vi.fn(),
  paneDropFromPoint: vi.fn(() => null),
  titleTabDropFromPoint: vi.fn(() => null),
}));

const ID = "transfer-1";
let root: Root;
let container: HTMLDivElement;
let deps: WindowTransferListenerDeps;
let state: { tabs: WorkspaceTab[]; sessions: Session[] };
let existing: WorkspaceTab;
let incomingTab: WorkspaceTab;
let incomingSession: Session;
let published: string[];
let unsubscribe: () => void;
let calls: Record<string, unknown[]>;
let responses: Record<string, () => Promise<unknown>>;

function raw(extra: Partial<WindowTransferPayload> = {}) {
  const payload = collectWindowTransfer(
    [incomingTab],
    [incomingSession],
    [incomingTab.id],
    incomingTab.id,
    new Set(),
    "/repo",
  )!;
  return JSON.stringify({ ...payload, ...extra });
}

function respond(command: string, answer: () => Promise<unknown>) {
  responses[command] = answer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function mount() {
  function Harness() {
    useWindowTransferListener(deps);
    return null;
  }
  act(() => root.render(createElement(Harness)));
}

/** Delivers the native notification; the listener is registered asynchronously. */
async function receive(id = ID) {
  await act(async () => {});
  await act(async () => native.handler!({ payload: id }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.handler = undefined;
  native.unlisten.mockClear();
  vi.mocked(clearWindowDragPreview).mockClear();
  vi.mocked(paneDropFromPoint).mockReset().mockReturnValue(null);
  vi.mocked(titleTabDropFromPoint).mockReset().mockReturnValue(null);
  existing = { ...newTab("existing-session"), id: "existing-tab" };
  incomingSession = { ...newSession("codex", "/repo"), id: "incoming-session" };
  incomingTab = { ...newTab(incomingSession.id), id: "incoming-tab" };
  state = { tabs: [existing], sessions: [] };
  calls = {};
  responses = {
    take_window_transfer: async () => raw(),
    window_transfer_ready: async () => undefined,
    reject_window_transfer: async () => undefined,
  };
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command: string, args?: unknown) => {
      (calls[command] ??= []).push(args);
      return responses[command]?.();
    });
  const store = (key: "tabs" | "sessions") => (update: unknown) => {
    const next =
      typeof update === "function"
        ? (update as (prev: never) => never)(state[key] as never)
        : update;
    (state as Record<string, unknown>)[key] = next;
    if (key === "tabs") deps.tabsRef.current = next as WorkspaceTab[];
    else deps.sessionsRef.current = next as Session[];
  };
  deps = {
    // The app mirrors the active tab into this ref; the rollback checks it.
    activateTab: vi.fn((id: string) => {
      deps.activeTabIdRef.current = id;
    }),
    tabsRef: { current: state.tabs },
    sessionsRef: { current: state.sessions },
    projectTerminalsRef: { current: [] },
    activeTabIdRef: { current: existing.id },
    projectCwdRef: { current: "/repo" },
    movingTabIds: { current: new Set() },
    movingSessionIds: { current: new Set() },
    skipForgetSessionIds: { current: new Set() },
    observedSessions: { current: new Map() },
    lastPersisted: { current: new Map() },
    lastBoundProvider: { current: new Map() },
    lastPersistedUserBlock: { current: new Map() },
    pendingPersist: { current: new Map() },
    setTabs: vi.fn(store("tabs")),
    setSessions: vi.fn(store("sessions")),
    setProjectTerminals: vi.fn(),
    setProjectCwd: vi.fn(),
    setMovingWindows: vi.fn(),
  };
  dismissWindowTransferNotice();
  published = [];
  unsubscribe = subscribeWindowTransferNotice(() => {
    const notice = getWindowTransferNotice();
    if (notice) published.push(`${notice.tone}: ${notice.message}`);
  });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  unsubscribe();
  act(() => root.unmount());
  document.querySelector("[data-drag-announcer]")?.remove();
  vi.unstubAllGlobals();
});

describe("receiving a tab from another window", () => {
  it("listens on this webview for the transfer notification", async () => {
    mount();
    await act(async () => {});
    expect(native.event).toBe("window_transfer_available");
  });

  it("adds the tab, then acknowledges it, and publishes nothing", async () => {
    const ready = deferred<undefined>();
    respond("window_transfer_ready", () => ready.promise);
    mount();
    await act(async () => {});
    const pending = native.handler!({ payload: ID });
    await act(async () => {});
    // Merged into this window and locked while the ACK is in flight.
    expect(state.tabs.map((tab) => tab.id)).toEqual(["existing-tab", "incoming-tab"]);
    expect(state.sessions.map((session) => session.id)).toEqual(["incoming-session"]);
    expect(deps.movingTabIds.current.has("incoming-tab")).toBe(true);
    expect(deps.movingSessionIds.current.has("incoming-session")).toBe(true);
    expect(calls.take_window_transfer).toEqual([{ transferId: ID }]);
    expect(calls.window_transfer_ready).toEqual([{ transferId: ID }]);
    expect(calls.reject_window_transfer).toBeUndefined();
    ready.resolve(undefined);
    await act(async () => {
      await pending;
    });
    expect(deps.activateTab).toHaveBeenCalledWith("incoming-tab");
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(deps.movingSessionIds.current.size).toBe(0);
    expect(state.tabs).toHaveLength(2);
    expect(calls.reject_window_transfer).toBeUndefined();
    expect(published).toEqual([]);
  });

  it("neither acknowledges nor rejects a transfer another window already took", async () => {
    respond("take_window_transfer", async () => null);
    mount();
    await receive();
    expect(calls.window_transfer_ready).toBeUndefined();
    expect(calls.reject_window_transfer).toBeUndefined();
    expect(state.tabs).toEqual([existing]);
    expect(published).toEqual([]);
    // The id is released, so a genuine later notification with it is handled again.
    await receive();
    expect(calls.take_window_transfer).toHaveLength(2);
  });

  it("handles one transfer id once while it is still being received", async () => {
    const taken = deferred<string | null>();
    respond("take_window_transfer", () => taken.promise);
    mount();
    await act(async () => {});
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = native.handler!({ payload: ID });
      second = native.handler!({ payload: ID });
    });
    taken.resolve(null);
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(calls.take_window_transfer).toHaveLength(1);
  });

  it("rejects a malformed payload before mounting anything and says why", async () => {
    respond("take_window_transfer", async () => "{ not json");
    mount();
    await receive();
    expect(calls.window_transfer_ready).toBeUndefined();
    expect(state.tabs).toEqual([existing]);
    expect(calls.reject_window_transfer).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatch(/^danger: The tab could not be placed in this window\./);
  });

  it("rejects a drop that is not on a tab group or a panel", async () => {
    respond("take_window_transfer", async () => raw({ dropPoint: { x: 10, y: 10 } }));
    mount();
    await receive();
    const reason = "Error: Drop the tab on a tab group or a panel to place it in this window.";
    expect(calls.reject_window_transfer).toEqual([{ transferId: ID, reason }]);
    expect(calls.window_transfer_ready).toBeUndefined();
    expect(state.tabs).toEqual([existing]);
    expect(clearWindowDragPreview).toHaveBeenCalled();
    expect(published).toEqual([
      "danger: The tab could not be placed in this window. Drop the tab on a tab group or a panel to place it in this window. It stays in its original window.",
    ]);
  });

  it("rejects a panel that is not ready to receive", async () => {
    respond("take_window_transfer", async () => raw({ dropPoint: { x: 10, y: 10 } }));
    vi.mocked(paneDropFromPoint).mockReturnValue({
      id: "existing-session",
      edge: "center",
      invalid: true,
    });
    mount();
    await receive();
    expect(calls.reject_window_transfer).toEqual([
      { transferId: ID, reason: "Error: This panel is not ready to receive a transfer." },
    ]);
    expect(state.tabs).toEqual([existing]);
    expect(published).toHaveLength(1);
  });

  it("rejects a drop on a panel that is itself moving to another window", async () => {
    respond("take_window_transfer", async () => raw({ dropPoint: { x: 10, y: 10 } }));
    vi.mocked(paneDropFromPoint).mockReturnValue({ id: "existing-session", edge: "center" });
    mount();
    deps.movingTabIds.current.add("existing-tab");
    await receive();
    expect(calls.reject_window_transfer).toHaveLength(1);
    expect(String((calls.reject_window_transfer![0] as { reason: string }).reason)).toContain(
      "This panel is moving to another window.",
    );
    expect(state.tabs).toEqual([existing]);
    expect(published).toHaveLength(1);
  });

  it("rejects a conversation that is already open here and keeps the existing one", async () => {
    state.sessions = [incomingSession];
    deps.sessionsRef.current = state.sessions;
    mount();
    await receive();
    expect(String((calls.reject_window_transfer![0] as { reason: string }).reason)).toContain(
      "already open in the destination window",
    );
    expect(state.sessions).toEqual([incomingSession]);
    expect(state.tabs).toEqual([existing]);
    expect(published).toHaveLength(1);
  });

  it("rolls everything back and rejects when the acknowledgement fails", async () => {
    respond("window_transfer_ready", async () => {
      throw new Error("Source window closed");
    });
    mount();
    await receive();
    // The imported tab, its session and the activation are all undone.
    expect(state.tabs).toEqual([existing]);
    expect(state.sessions).toEqual([]);
    expect(deps.setProjectCwd).toHaveBeenLastCalledWith("/repo");
    expect(deps.activateTab).toHaveBeenLastCalledWith("existing-tab");
    expect(deps.observedSessions.current.size).toBe(0);
    expect(deps.lastPersisted.current.size).toBe(0);
    expect(deps.skipForgetSessionIds.current.size).toBe(0);
    expect(calls.reject_window_transfer).toEqual([
      { transferId: ID, reason: "Error: Source window closed" },
    ]);
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(deps.movingSessionIds.current.size).toBe(0);
    expect(published).toEqual([
      "danger: The tab could not be placed in this window. Source window closed. It stays in its original window.",
    ]);
  });

  it("rejects instead of docking when this window closed while the payload was being taken", async () => {
    const taken = deferred<string | null>();
    respond("take_window_transfer", () => taken.promise);
    mount();
    await act(async () => {});
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = native.handler!({ payload: ID });
    });
    act(() => root.unmount());
    taken.resolve(raw());
    await act(async () => {
      await pending;
    });
    expect(native.unlisten).toHaveBeenCalled();
    expect(calls.window_transfer_ready).toBeUndefined();
    expect(state.tabs).toEqual([existing]);
    expect(calls.reject_window_transfer).toEqual([
      { transferId: ID, reason: "Error: The destination window is no longer ready." },
    ]);
    expect(deps.setMovingWindows).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
