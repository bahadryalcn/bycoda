import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { confirmCloseTerminal } from "../../../features/terminal/model/terminalClose";
import {
  createProjectTerminal,
  type ProjectTerminalDock,
} from "../../../features/projects/model/projectTerminal";
import { createConversationTerminalControl } from "./conversationTerminalControl";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../features/terminal/model/terminalClose", () => ({
  confirmCloseTerminal: vi.fn(),
}));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: null }),
}));
vi.mock("../../../features/group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
const context = { cwd: "/project", sessionId: "owner", title: "Owner" };
const id = "conversation-terminal:owner:request";
function setup() {
  const docks = { current: [] as ProjectTerminalDock[] };
  let active = true;
  const open = vi.fn((cwd: string, _profile?: string, terminalId?: string) => {
    if (!docks.current.length)
      docks.current = [
        createProjectTerminal(cwd, { id: terminalId!, path: "Terminal", terminal: true, cwd }),
      ];
    return true;
  });
  const setDocks = vi.fn((update) => {
    docks.current = update(docks.current);
  });
  const control = createConversationTerminalControl(() => ({
    docks,
    open,
    setDocks,
    stillActive: () => active,
  }));
  return {
    docks,
    open,
    setDocks,
    control,
    deactivate: () => {
      active = false;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue({ foreground: null, supported: true });
  vi.mocked(confirmCloseTerminal).mockResolvedValue(true);
});
describe("conversation-owned terminal lifecycle", () => {
  it("interrupts only its own active terminal with exactly Ctrl-C through native PTY ownership", async () => {
    const s = setup();
    await s.control(context, "terminals.create", { requestId: "request" });
    vi.mocked(invoke).mockClear();
    await expect(s.control(context, "terminals.interrupt", { terminalId: id })).resolves.toEqual({
      terminalId: id,
      accepted: true,
      bytes: 1,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id, data: "\u0003" });
    expect(confirmCloseTerminal).not.toHaveBeenCalled();
    vi.mocked(invoke).mockClear();
    await expect(
      s.control(context, "terminals.interrupt", {
        terminalId: "conversation-terminal:other:request",
      }),
    ).rejects.toThrow("not created");
    await expect(
      s.control(context, "terminals.interrupt", {
        terminalId: "conversation-terminal:owner:missing",
      }),
    ).rejects.toThrow("not present");
    s.deactivate();
    await expect(s.control(context, "terminals.interrupt", { terminalId: id })).rejects.toThrow(
      "not active",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it("creates through the existing dock and waits for native spawn with stable session/request identity", async () => {
    const s = setup();
    await expect(s.control(context, "terminals.create", { requestId: "request" })).resolves.toEqual(
      { terminalId: id, created: true, running: true },
    );
    await expect(
      s.control(context, "terminals.create", { requestId: "request" }),
    ).resolves.toMatchObject({ terminalId: id });
    expect(s.docks.current[0].pane.files).toHaveLength(1);
    expect(s.open).toHaveBeenCalledWith("/project", undefined, id);
    expect(invoke).toHaveBeenCalledWith("pty_status", { id });
  });
  it("cannot close another conversation's terminal or create on a remote/inactive workspace", async () => {
    const s = setup();
    await expect(
      s.control(context, "terminals.close", { terminalId: "manual-terminal" }),
    ).rejects.toThrow("not created");
    await expect(
      s.control({ ...context, cwd: "remote://mac/project" }, "terminals.create", {
        requestId: "request",
      }),
    ).rejects.toThrow("local workspace");
    s.deactivate();
    await expect(s.control(context, "terminals.create", { requestId: "request" })).rejects.toThrow(
      "not active",
    );
    expect(s.open).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("preserves close cancellation, confirms strict native kill and refuses recreating a closed request", async () => {
    const s = setup();
    await s.control(context, "terminals.create", { requestId: "request" });
    vi.mocked(invoke).mockClear();
    vi.mocked(confirmCloseTerminal).mockResolvedValueOnce(false);
    await expect(s.control(context, "terminals.close", { terminalId: id })).resolves.toMatchObject({
      closed: false,
      cancelled: true,
    });
    expect(invoke).not.toHaveBeenCalled();
    await expect(s.control(context, "terminals.close", { terminalId: id })).resolves.toMatchObject({
      closed: true,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_kill", { id });
    expect(s.docks.current).toEqual([]);
    await expect(s.control(context, "terminals.create", { requestId: "request" })).rejects.toThrow(
      "was closed",
    );
  });
  it("rechecks conversation after confirmation and propagates native kill failures without removing the dock", async () => {
    const s = setup();
    await s.control(context, "terminals.create", { requestId: "request" });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Foreign window"));
    await expect(s.control(context, "terminals.close", { terminalId: id })).rejects.toThrow(
      "Foreign window",
    );
    expect(s.docks.current[0].pane.files).toHaveLength(1);
    vi.mocked(invoke).mockClear();
    vi.mocked(confirmCloseTerminal).mockImplementationOnce(async () => {
      s.deactivate();
      return true;
    });
    await expect(s.control(context, "terminals.close", { terminalId: id })).rejects.toThrow(
      "changed during",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it("refuses late close confirmation after the native request deadline", async () => {
    const s = setup();
    await s.control(context, "terminals.create", { requestId: "request" });
    const deadline = Date.now() + 10000;
    const now = vi.spyOn(Date, "now");
    vi.mocked(invoke).mockClear();
    vi.mocked(confirmCloseTerminal).mockImplementationOnce(async () => {
      now.mockReturnValue(deadline + 1);
      return true;
    });
    try {
      await expect(
        s.control({ ...context, deadline }, "terminals.close", { terminalId: id }),
      ).rejects.toThrow("changed during");
      expect(invoke).not.toHaveBeenCalled();
      expect(s.docks.current[0].pane.files).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });
});
