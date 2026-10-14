import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  emit: vi.fn(),
  emitTo: vi.fn(),
  listen: vi.fn(),
  invoke: vi.fn(),
  getAllWindows: vi.fn(),
  show: vi.fn(),
  unminimize: vi.fn(),
  setFocus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: api.emit,
  emitTo: api.emitTo,
  listen: api.listen,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: api.getAllWindows,
  getCurrentWindow: () => ({ label: "tools", listen: api.listen }),
}));
import {
  chooseNavigationWindow,
  routeWindowDestination,
  type NavigationWindow,
} from "./windowNavigation";

const entry = (label: string, extra: Partial<NavigationWindow> = {}): NavigationWindow => ({
  label,
  tools: false,
  grouped: false,
  activeTool: null,
  cwd: "G:/repo",
  sessionIds: [],
  ...extra,
});
const worker = { kind: "session" as const, sessionId: "worker", cwd: "G:/repo" };
const tools = entry("tools", {
  tools: true,
  grouped: true,
  activeTool: "tasks",
  sessionIds: ["worker"],
});

describe("choose an existing workspace window", () => {
  it("keeps task tools intact and prefers the actual conversation owner over main", () => {
    expect(
      chooseNavigationWindow(
        [tools, entry("main"), entry("session", { sessionIds: ["worker"] })],
        worker,
        "tools",
      )?.label,
    ).toBe("session");
    expect(chooseNavigationWindow([tools, entry("main")], worker, "tools")?.label).toBe("main");
    expect(chooseNavigationWindow([tools], worker, "tools")).toBeUndefined();
  });
  it("reuses Notes in another window of the same project, preserving Windows path identity", () => {
    expect(
      chooseNavigationWindow(
        [
          tools,
          entry("notes", { tools: true, activeTool: "notes", cwd: "g:\\REPO\\" }),
          entry("wrong-project", { activeTool: "notes", cwd: "G:/other" }),
        ],
        { kind: "tool", tool: "notes", cwd: "G:/repo" },
        "tools",
      )?.label,
    ).toBe("notes");
  });
  it("distinguishes combined windows from individual tool windows", () => {
    const notes = entry("notes", { tools: true, activeTool: "notes" });
    expect(
      chooseNavigationWindow(
        [tools, notes],
        { kind: "tool", tool: "notes", cwd: "G:/repo", grouped: true },
        "notes",
      )?.label,
    ).toBe("tools");
    expect(
      chooseNavigationWindow(
        [tools, notes],
        { kind: "tool", tool: "notes", cwd: "G:/repo", grouped: false },
        "tools",
      )?.label,
    ).toBe("notes");
  });
});

describe("cross-window navigation delivery", () => {
  let windows: NavigationWindow[];
  let listeners: Map<string, (event: { payload: any }) => void>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    windows = [tools, entry("main")];
    listeners = new Map();
    api.listen.mockImplementation(async (name, callback) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    });
    api.getAllWindows.mockImplementation(async () =>
      windows.map((item) => ({
        label: item.label,
        show: api.show,
        unminimize: api.unminimize,
        setFocus: api.setFocus,
      })),
    );
    api.emit.mockImplementation(async (_name, query) =>
      windows.forEach((window) =>
        listeners.get("workspace_navigation_candidate")?.({ payload: { id: query.id, window } }),
      ),
    );
    api.emitTo.mockImplementation(async (_owner, _name, request) => {
      listeners.get("workspace_navigation_result")?.({ payload: { id: request.id } });
    });
    api.invoke.mockResolvedValue(undefined);
    api.show.mockResolvedValue(undefined);
    api.unminimize.mockResolvedValue(undefined);
    api.setFocus.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());
  it("delivers once on repeated clicks, then restores and focuses the destination", async () => {
    const first = routeWindowDestination(worker, true);
    const second = routeWindowDestination(worker, true);
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(160);
    expect(await first).toBe(true);
    expect(api.emitTo).toHaveBeenCalledOnce();
    expect(api.emitTo).toHaveBeenCalledWith(
      "main",
      "workspace_navigation_open",
      expect.objectContaining({ target: worker }),
    );
    expect(api.unminimize).toHaveBeenCalledOnce();
    expect(api.show).toHaveBeenCalledOnce();
    expect(api.setFocus).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
  it("opens a conversation window when only the tools window exists", async () => {
    windows = [tools];
    api.invoke.mockImplementation(async () => {
      windows.push(entry("new-session"));
    });
    const opened = routeWindowDestination(worker, true);
    await vi.advanceTimersByTimeAsync(320);
    expect(await opened).toBe(true);
    expect(api.invoke).toHaveBeenCalledWith("open_new_window");
    expect(api.emitTo).toHaveBeenCalledWith(
      "new-session",
      "workspace_navigation_open",
      expect.anything(),
    );
  });
  it("leaves ordinary session navigation local when no existing owner has it open", async () => {
    const opened = routeWindowDestination(worker);
    await vi.advanceTimersByTimeAsync(160);
    expect(await opened).toBe(false);
    expect(api.emitTo).not.toHaveBeenCalled();
    expect(api.invoke).not.toHaveBeenCalled();
  });
  it("surfaces destination failures without focusing or opening a replacement", async () => {
    api.emitTo.mockImplementation(async (_owner, _name, request) => {
      listeners.get("workspace_navigation_result")?.({
        payload: { id: request.id, error: "Session unavailable" },
      });
    });
    const opened = routeWindowDestination(worker, true);
    const rejected = expect(opened).rejects.toThrow("Session unavailable");
    await vi.advanceTimersByTimeAsync(160);
    await rejected;
    expect(api.setFocus).not.toHaveBeenCalled();
    expect(api.invoke).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it("times out visibly when the destination stops responding", async () => {
    api.emitTo.mockResolvedValue(undefined);
    const opened = routeWindowDestination(worker, true);
    const rejected = expect(opened).rejects.toThrow("did not respond");
    await vi.advanceTimersByTimeAsync(15200);
    await rejected;
    expect(api.setFocus).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it("reuses the calling combined window without opening another native window", async () => {
    const opened = routeWindowDestination({
      kind: "tool",
      tool: "tasks",
      cwd: "G:/repo",
      grouped: true,
    });
    await vi.advanceTimersByTimeAsync(160);
    expect(await opened).toBe(true);
    expect(api.invoke).not.toHaveBeenCalled();
    expect(api.emitTo).not.toHaveBeenCalled();
  });
});
