import { expect, it, vi } from "vitest";
import { handleRoomWorkspaceAction } from "./roomWorkspaceControl";
import type { createVoiceWorkspaceActions } from "../bridges/useVoiceWorkspaceActions";

it("uses native project target and refuses authority or visibility changes before dispatch", async () => {
  const execute = vi.fn(async () => ({ action: "workspace.sessions.open", status: "accepted" as const }));
  const workspace = { execute } as unknown as ReturnType<typeof createVoiceWorkspaceActions>;
  const target = { projectCwd: "canonical", valid: vi.fn().mockReturnValue(true) };
  await handleRoomWorkspaceAction("workspace.sessions.open", { requestId: "r", sessionId: "s", projectPath: "forged" }, target, async () => true, workspace);
  expect(execute).toHaveBeenCalledWith("workspace.sessions.open", { requestId: "r", sessionId: "s", projectPath: "canonical" });
  target.valid.mockReturnValueOnce(true).mockReturnValueOnce(false);
  await expect(handleRoomWorkspaceAction("workspace.sessions.open", {}, target, async () => true, workspace)).rejects.toThrow("unavailable or private");
  await expect(handleRoomWorkspaceAction("workspace.sessions.open", {}, target, async () => false, workspace)).rejects.toThrow("authority is unavailable");
  expect(execute).toHaveBeenCalledOnce();
});

it("passes the native request identity and waits for the original workspace action", async () => {
  let finish!: () => void;
  const execute = vi.fn(() => new Promise<{ action: string; status: "accepted" }>(resolve => { finish = () => resolve({ action: "workspace.projects.select", status: "accepted" }); }));
  const workspace = { execute } as unknown as ReturnType<typeof createVoiceWorkspaceActions>;
  const result = handleRoomWorkspaceAction("workspace.projects.select", { requestId: "original" }, { projectCwd: "canonical", valid: () => true }, async () => true, workspace, "native-pending");
  await vi.waitFor(() => expect(execute).toHaveBeenCalledWith("workspace.projects.select", { requestId: "original", projectPath: "canonical" }, "native-pending"));
  let settled = false;
  void result.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await expect(result).resolves.toMatchObject({ status: "accepted" });
});

