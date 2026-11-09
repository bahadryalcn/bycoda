import { afterEach, describe, expect, it, vi } from "vitest";
import { newTerminalFile } from "../../workspace/model/layout";
import { confirmCloseTerminal, confirmCloseTerminals } from "./terminalClose";

const getPtyStatus = vi.fn();
const confirmInApp = vi.fn();

vi.mock("../../../platform/tauri/pty", () => ({
  getPtyStatus: (...args: unknown[]) => getPtyStatus(...args),
}));

vi.mock("../../../shared/model/appConfirm", () => ({
  confirmInApp: (...args: unknown[]) => confirmInApp(...args),
}));

describe("confirmCloseTerminal", () => {
  afterEach(() => {
    getPtyStatus.mockReset();
    confirmInApp.mockReset();
  });

  it("allows close when only the shell is foreground", async () => {
    const file = newTerminalFile("/repo");
    getPtyStatus.mockResolvedValue({ foreground: null });
    await expect(confirmCloseTerminal(file)).resolves.toBe(true);
    expect(getPtyStatus).toHaveBeenCalledWith(file.id);
    expect(confirmInApp).not.toHaveBeenCalled();
  });

  it("prompts when a process is running", async () => {
    const file = newTerminalFile("/repo", "agent-terminal");
    getPtyStatus.mockResolvedValue({ foreground: "npm" });
    confirmInApp.mockResolvedValue(false);
    await expect(confirmCloseTerminal(file)).resolves.toBe(false);
    expect(confirmInApp).toHaveBeenCalledWith({
      title: "Close terminal?",
      message: "“npm” is still running in agent-terminal. Closing the terminal stops it.",
      confirmLabel: "Close terminal",
      tone: "danger",
    });
  });

  it("asks before closing an idle last terminal, since the panel closes with it", async () => {
    const file = newTerminalFile("/repo", "work");
    getPtyStatus.mockResolvedValue({ foreground: null });
    confirmInApp.mockResolvedValue(false);
    await expect(confirmCloseTerminal(file, { last: true })).resolves.toBe(false);
    expect(confirmInApp).toHaveBeenCalledWith({
      title: "Close terminal?",
      message:
        "work is the last terminal. Closing it also closes the terminal panel. To keep it, hide the panel instead.",
      confirmLabel: "Close terminal",
      tone: "normal",
    });
  });

  it("uses the running-process prompt for a busy last terminal", async () => {
    const file = newTerminalFile("/repo", "work");
    getPtyStatus.mockResolvedValue({ foreground: "node" });
    confirmInApp.mockResolvedValue(true);
    await expect(confirmCloseTerminal(file, { last: true })).resolves.toBe(true);
    expect(confirmInApp).toHaveBeenCalledOnce();
    expect(confirmInApp).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger" }));
  });

  it.each([false, true])(
    "asks conservatively for unsupported or failed status (failed=%s)",
    async (failed) => {
      const file = newTerminalFile("/repo", "work");
      if (failed) getPtyStatus.mockRejectedValue(new Error("connection lost"));
      else getPtyStatus.mockResolvedValue({ foreground: null, supported: false });
      confirmInApp.mockResolvedValue(false);
      await expect(confirmCloseTerminal(file)).resolves.toBe(false);
      expect(confirmInApp).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Closing the terminal may stop running work"),
          tone: "danger",
        }),
      );
    },
  );
});

describe("confirmCloseTerminals", () => {
  afterEach(() => {
    getPtyStatus.mockReset();
    confirmInApp.mockReset();
  });

  it("summarizes multiple running terminals", async () => {
    const first = newTerminalFile("/repo", "dev");
    const second = newTerminalFile("/repo", "test");
    getPtyStatus.mockImplementation(async (id: string) => {
      if (id === first.id) return { foreground: "vite" };
      if (id === second.id) return { foreground: "jest" };
      return { foreground: null };
    });
    confirmInApp.mockResolvedValue(true);
    await expect(confirmCloseTerminals([first, second])).resolves.toBe(true);
    expect(confirmInApp).toHaveBeenCalledWith({
      title: "Close 2 terminals?",
      message:
        "These terminals are still running:\n• dev (vite)\n• test (jest)\n\nClosing them stops the work running in them.",
      confirmLabel: "Close 2 terminals",
      tone: "danger",
    });
  });

  it("includes unknown status in a group while excluding confirmed idle shells", async () => {
    const files = [
      newTerminalFile("/repo", "unknown"),
      newTerminalFile("/repo", "idle"),
      newTerminalFile("/repo", "build"),
    ];
    getPtyStatus
      .mockResolvedValueOnce({ foreground: null, supported: false })
      .mockResolvedValueOnce({ foreground: null, supported: true })
      .mockResolvedValueOnce({ foreground: "cargo", supported: true });
    confirmInApp.mockResolvedValue(false);
    await expect(confirmCloseTerminals(files)).resolves.toBe(false);
    expect(confirmInApp).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "These terminals may still have running processes:\n• unknown (process status unknown)\n• build (cargo)\n\nClosing them stops the work running in them.",
      }),
    );
  });
});
