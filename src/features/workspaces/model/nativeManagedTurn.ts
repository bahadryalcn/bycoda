import { invoke } from "@tauri-apps/api/core";
import { upsertSession } from "../../sessions/data/sessionStore";
import type { Session } from "../../sessions/model/session";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { t } from "../../../shared/i18n";

/** Host admission uses the durable native boundary, never a renderer-supplied cwd. */
export async function beginNativeManagedTurn(
  session: Session,
  runId: string,
): Promise<((interrupted: boolean) => Promise<void>) | undefined> {
  if (!session.workspaceId || isRemoteProjectPath(session.cwd)) return undefined;
  if (!session.worktreeCwd || session.worktreeRemoved)
    throw new Error(t("Resume this managed workspace before starting a turn."));
  const user = [...session.blocks].reverse().find((block) => block.role === "user" && !block.draft);
  if (!user) throw new Error(t("The accepted user boundary is unavailable. Reload this session."));
  const saved = await upsertSession(session);
  if (!saved)
    throw new Error(t("The conversation could not be saved. Retry before starting a turn."));
  const request = { sessionId: session.id, userBlockId: user.id, runId };
  await invoke("managed_turn_begin", request);
  return async (interrupted) => {
    // Failure to retire a writer is unknown, so its native/Host fence must remain.
    if (interrupted)
      throw new Error(t("The managed writer could not be retired. Reconnect before continuing."));
    await invoke("managed_turn_end", request);
  };
}
