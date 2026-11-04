// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadBootWorkspace } from "./appLifecycle";
import {
  isPrimaryWorkspaceWindow,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
} from "../../features/sessions/data/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
const nativeWindow = vi.hoisted(() => ({ label: "main", unavailable: false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (nativeWindow.unavailable) throw new Error("window unavailable");
    return { label: nativeWindow.label };
  },
}));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  nativeWindow.label = "main";
  nativeWindow.unavailable = false;
  vi.clearAllMocks();
});

it("does not consume the main window's resume, transfer or history during tool boot", async () => {
  window.history.replaceState(null, "", "/?tool=tasks&tools=all&cwd=%2Frepo");
  expect(await loadBootWorkspace()).toEqual({
    windowTransfer: null,
    resumed: null,
    history: [],
    historyCwd: null,
  });
  expect(invoke).not.toHaveBeenCalled();
});

it("does not overwrite workspace or recovery data on save or close", async () => {
  window.history.replaceState(null, "", "/?tool=notes");
  await saveWorkspaceSnapshot({ projectCwd: "/other" });
  await replaceInFlightSessions([]);
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps normal workspace persistence enabled", async () => {
  await saveWorkspaceSnapshot({ projectCwd: "/main" });
  await replaceInFlightSessions([{ sessionId: "running", cwd: "/main" }]);
  expect(invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
    snapshot: { projectCwd: "/main" },
  });
  expect(invoke).toHaveBeenCalledWith("session_set_in_flight", {
    sessions: [{ sessionId: "running", cwd: "/main" }],
  });
});

it("secondary windows cannot write the primary snapshot but can persist their own in-flight rows", async () => {
  nativeWindow.label = "window-2";
  await saveWorkspaceSnapshot({ projectCwd: "/other" });
  await replaceInFlightSessions([{ sessionId: "running", cwd: "/other" }]);
  expect(invoke).not.toHaveBeenCalledWith("workspace_set_snapshot", expect.anything());
  expect(invoke).toHaveBeenCalledWith("session_set_in_flight", {
    sessions: [{ sessionId: "running", cwd: "/other" }],
  });
});

it.each(["secondary", "unknown"])(
  "boots %s identity without consuming the shared workspace",
  async (identity) => {
    nativeWindow.label = "window-2";
    nativeWindow.unavailable = identity === "unknown";
    vi.resetModules();
    const lifecycle = await import("./appLifecycle");
    expect(await lifecycle.loadBootWorkspace()).toEqual({
      windowTransfer: null,
      resumed: null,
      history: [],
      historyCwd: null,
    });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([name]) => name === "workspace_get_snapshot" || name === "session_list_in_flight",
        ),
    ).toBe(false);
  },
);

it("does not write a primary snapshot when native identity is unavailable", async () => {
  nativeWindow.unavailable = true;
  expect(isPrimaryWorkspaceWindow()).toBe(false);
  await saveWorkspaceSnapshot({ projectCwd: "/unknown" });
  expect(invoke).not.toHaveBeenCalled();
});
