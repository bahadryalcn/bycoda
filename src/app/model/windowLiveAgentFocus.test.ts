import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  emitTo: vi.fn(),
  show: vi.fn(),
  unminimize: vi.fn(),
  setFocus: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(),
  emitTo: api.emitTo,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: api.getAllWindows,
  getCurrentWindow: vi.fn(),
}));
import { focusWindowLiveAgent } from "./useWindowLiveAgents";

const agent = {
  id: "session",
  cwd: "/project",
  title: "Session",
  harness: "claude" as const,
  activity: "Working",
  needsApproval: true,
  done: false,
  ownerWindowLabel: "window-2",
};

describe("focus a live session in its owning window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAllWindows.mockResolvedValue([
      {
        label: "window-2",
        show: api.show,
        unminimize: api.unminimize,
        setFocus: api.setFocus,
      },
    ]);
  });

  it("targets the owner and restores its window without transferring execution", async () => {
    await focusWindowLiveAgent(agent);
    expect(api.emitTo).toHaveBeenCalledWith("window-2", "workspace_focus_live_agent", "session");
    expect(api.show).toHaveBeenCalledOnce();
    expect(api.unminimize).toHaveBeenCalledOnce();
    expect(api.setFocus).toHaveBeenCalledOnce();
  });

  it("does not create a replacement session when the owner has closed", async () => {
    api.getAllWindows.mockResolvedValue([]);
    await expect(focusWindowLiveAgent(agent)).rejects.toThrow("window has closed");
    expect(api.emitTo).not.toHaveBeenCalled();
  });
});
