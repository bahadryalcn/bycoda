import type { createVoiceWorkspaceActions } from "../bridges/useVoiceWorkspaceActions";

const actions = new Set(["workspace.projects.select", "workspace.sessions.create", "workspace.sessions.open", "workspace.sessions.stop"]);
export const isRoomWorkspaceAction = (action: string) => actions.has(action);

/** Native request owns source, canonical project and deadline; recheck before dispatch. */
export async function handleRoomWorkspaceAction(
  action: string,
  input: Record<string, unknown>,
  target: { projectCwd: string; valid: () => boolean } | undefined,
  authorize: () => Promise<boolean>,
  workspace: ReturnType<typeof createVoiceWorkspaceActions>,
  workspaceRequestId?: string,
) {
  if (!isRoomWorkspaceAction(action)) throw new Error("Unsupported Room workspace action.");
  if (action === "workspace.sessions.create" && input.submit !== undefined && input.submit !== false)
    throw new Error("Room session creation cannot submit work.");
  if (!target || !target.valid() || !(await authorize()))
    throw new Error("Assistant Room target or authority is unavailable.");
  if (!target.valid()) throw new Error("Target project is unavailable or private.");
  const args = { ...input, projectPath: target.projectCwd };
  return workspaceRequestId ? workspace.execute(action, args, workspaceRequestId) : workspace.execute(action, args);
}
