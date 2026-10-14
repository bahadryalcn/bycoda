// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listen: vi.fn(), emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: api.listen, emitTo: api.emitTo }));
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(),
  getCurrentWindow: () => ({ label: "tools", listen: api.listen }),
}));
import {
  useWindowNavigation,
  type WindowDestination,
  type NavigationWindow,
} from "./windowNavigation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const listeners = new Map<string, (event: { payload: any }) => void | Promise<void>>();
let root: ReturnType<typeof createRoot>;
const open = vi.fn();
const state: Omit<NavigationWindow, "label"> = {
  tools: true,
  grouped: true,
  activeTool: "tasks",
  cwd: "G:/repo",
  sessionIds: [],
};
function Harness({ value = state }: { value?: typeof state }) {
  useWindowNavigation(value, open);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  listeners.clear();
  api.emitTo.mockResolvedValue(undefined);
  api.listen.mockImplementation(async (name, callback) => {
    listeners.set(name, callback);
    return () => listeners.delete(name);
  });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(h(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("advertises current content after switching tools and unregisters when closed", async () => {
  await act(async () => root.render(h(Harness, { value: { ...state, activeTool: "notes" } })));
  await listeners.get("workspace_navigation_query")!({ payload: { id: "query", replyTo: "main" } });
  expect(api.emitTo).toHaveBeenCalledWith("main", "workspace_navigation_candidate", {
    id: "query",
    window: { ...state, label: "tools", activeTool: "notes" },
  });
  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
});

it("refuses to replace tools with a conversation even if an old request arrives", async () => {
  await listeners.get("workspace_navigation_open")!({
    payload: { id: "open", replyTo: "main", target: { kind: "session", sessionId: "worker" } },
  });
  expect(open).not.toHaveBeenCalled();
  expect(api.emitTo).toHaveBeenCalledWith(
    "main",
    "workspace_navigation_result",
    expect.objectContaining({ id: "open", error: expect.stringContaining("destination changed") }),
  );
});

it("acknowledges only after destination navigation completes", async () => {
  let finish!: () => void;
  open.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const target: WindowDestination = { kind: "tool", tool: "notes", cwd: "G:/repo" };
  const delivered = listeners.get("workspace_navigation_open")!({
    payload: { id: "open", replyTo: "main", target },
  });
  expect(open).toHaveBeenCalledWith(target);
  expect(api.emitTo).not.toHaveBeenCalled();
  finish();
  await delivered;
  expect(api.emitTo).toHaveBeenCalledWith("main", "workspace_navigation_result", {
    id: "open",
    error: undefined,
  });
});

it("rejects requests for another project rather than changing its tools workspace", async () => {
  await listeners.get("workspace_navigation_open")!({
    payload: {
      id: "open",
      replyTo: "main",
      target: { kind: "tool", tool: "notes", cwd: "G:/other" },
    },
  });
  expect(open).not.toHaveBeenCalled();
});
