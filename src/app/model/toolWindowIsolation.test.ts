// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadBootWorkspace } from "./appLifecycle";
import { readBindingEvidencePage } from "../../features/connections/model/hostSessionBindingDatabase";
import {
  isPrimaryWorkspaceWindow,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
} from "../../features/sessions/data/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: () => false,
}));
vi.mock("../../features/connections/model/hostSessionBindingDatabase", () => ({
  readBindingEvidencePage: vi.fn(async () => []),
  skipImportedNativeBindingLegacy: vi.fn(),
}));
const nativeWindow = vi.hoisted(() => ({ label: "main", unavailable: false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (nativeWindow.unavailable) throw new Error("window unavailable");
    return { label: nativeWindow.label };
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(readBindingEvidencePage).mockReset().mockResolvedValue([]);
  window.history.replaceState(null, "", "/");
  nativeWindow.label = "main";
  nativeWindow.unavailable = false;
  vi.clearAllMocks();
});

it.each(["/?tool=tasks&tools=all", "/?tool=notes"])(
  "waits for session owner storage before booting %s",
  async (url) => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", {});
    window.history.replaceState(null, "", url);
    const database = await import("../../features/connections/model/hostSessionBindingDatabase");
    let finishRead!: () => void;
    vi.mocked(database.readBindingEvidencePage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve([]);
        }),
    );
    const lifecycle = await import("./appLifecycle");
    const bindings = await import("../../features/connections/model/sessionExecutionBinding");
    const boot = lifecycle.loadBootWorkspace();
    let ready = false;
    void boot.then(() => {
      ready = true;
    });
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(() => bindings.hostSessionBinding({ id: "session" })).toThrow(
      "Session owner storage is still loading. Sending is held.",
    );
    finishRead();
    expect(await boot).toEqual({
      windowTransfer: null,
      resumed: null,
      history: [],
      historyCwd: null,
    });
    expect(bindings.hostSessionBinding({ id: "session" })).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("keeps tool boot blocked when session owner storage fails", async () => {
  vi.resetModules();
  window.history.replaceState(null, "", "/?tool=tasks&tools=all");
  vi.mocked(readBindingEvidencePage).mockRejectedValueOnce(new Error("owner storage unavailable"));
  const lifecycle = await import("./appLifecycle");
  await expect(lifecycle.loadBootWorkspace()).rejects.toThrow("owner storage unavailable");
  expect(invoke).not.toHaveBeenCalled();
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
