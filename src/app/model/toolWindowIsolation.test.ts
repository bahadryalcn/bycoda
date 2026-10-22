// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadBootWorkspace } from "./appLifecycle";
import {
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
} from "../../features/sessions/data/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => {
  window.history.replaceState(null, "", "/");
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
