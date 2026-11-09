import { beforeEach, expect, it, vi } from "vitest";
import { useSessionShell } from "./useSessionShell";
import { newDefaultSession } from "../../../features/sessions/model/session";
const state = vi.hoisted(() => ({
  sessions: [] as import("../../../features/sessions/model/session").Session[],
  pending: false,
  flush: vi.fn(),
  run: vi.fn(),
  notice: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("../../../features/connections/model/sessionExecutionBinding", () => ({
  flushHostSessionBindings: () => state.flush(),
  hostSessionBinding: () => undefined,
  hostSessionBindingsPending: () => state.pending,
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  sessionsRef: {
    get current() {
      return state.sessions;
    },
    set current(value) {
      state.sessions = value;
    },
  },
  setSessions: (update: (sessions: typeof state.sessions) => typeof state.sessions) => {
    state.sessions = update(state.sessions);
  },
}));
vi.mock("../../../platform/tauri/fs", () => ({
  runShellCommand: (...args: unknown[]) => state.run(...args),
}));
vi.mock("../../../features/terminal/model/terminalProfiles", () => ({
  loadTerminalProfile: () => undefined,
}));
vi.mock("./submit/submitNotice", () => ({
  showSubmitNotice: (...args: unknown[]) => state.notice(...args),
}));
beforeEach(() => {
  state.sessions = [newDefaultSession("G:/repo")];
  state.pending = false;
  state.flush.mockReset().mockResolvedValue(undefined);
  state.run.mockReset();
  state.notice.mockReset();
});
const actions = () =>
  useSessionShell({
    removingSessionIds: { current: new Set() },
    getSubmitSessionRef: () => ({ current: vi.fn() }),
  });

it("refuses synchronous acceptance while owner publication is pending so composer retains its draft", async () => {
  state.pending = true;
  state.flush.mockRejectedValue(new Error("owner quota"));
  expect(actions().runSessionShell(state.sessions[0].id, "echo hello")).toBe(false);
  await Promise.resolve();
  expect(state.run).not.toHaveBeenCalled();
  expect(state.sessions[0].blocks).toHaveLength(0);
  expect(state.notice).toHaveBeenLastCalledWith(state.sessions[0].id, "owner quota", "error");
});

it("waits for durable owner verification before invoking Native shell", async () => {
  let release!: () => void;
  state.flush.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  state.run.mockResolvedValue({ output: "done", exitCode: 0, timedOut: false });
  expect(actions().runSessionShell(state.sessions[0].id, "echo hello")).toBe(true);
  expect(state.run).not.toHaveBeenCalled();
  release();
  await Promise.resolve();
  expect(state.run).toHaveBeenCalledOnce();
});
