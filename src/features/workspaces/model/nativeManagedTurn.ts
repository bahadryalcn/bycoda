import { invoke } from "@tauri-apps/api/core";
import { upsertSession } from "../../sessions/data/sessionStore";
import type { Session } from "../../sessions/model/session";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { t } from "../../../shared/i18n";

export interface NativeManagedTurnRecovery {
  released: boolean;
  reason?: string;
}

/** The native store supplies the pending identity; the renderer cannot choose a turn to release. */
export async function recoverNativeManagedTurn(
  sessionId: string,
): Promise<NativeManagedTurnRecovery> {
  const result = await invoke<NativeManagedTurnRecovery>("managed_turn_recover", { sessionId });
  if (
    !result ||
    typeof result.released !== "boolean" ||
    (result.reason !== undefined && typeof result.reason !== "string")
  )
    throw new Error(t("The Host did not confirm the managed turn recovery state."));
  return result;
}

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
  // A retained starting row can fence session persistence itself. Reconcile it
  // before saving the next boundary; no pending row is a native-only no-op.
  let recovery: NativeManagedTurnRecovery;
  try {
    recovery = await recoverNativeManagedTurn(session.id);
  } catch (error) {
    throw new Error(`Managed turn recovery could not be confirmed: ${String(error)}`);
  }
  if (!recovery.released)
    throw new Error(
      `Managed turn recovery blocked: ${recovery.reason || t("This turn is still fenced. The Host could not confirm that no execution occurred.")}`,
    );
  const saved = await upsertSession(session);
  if (!saved)
    throw new Error(t("The conversation could not be saved. Retry before starting a turn."));
  const request = { sessionId: session.id, userBlockId: user.id, runId };
  try {
    await invoke("managed_turn_begin", request);
  } catch (error) {
    throw new Error(`Managed turn could not start: ${String(error)}`);
  }
  return async (interrupted) => {
    // Failure to retire a writer is unknown, so its native/Host fence must remain.
    if (interrupted)
      throw new Error(t("The managed writer could not be retired. Reconnect before continuing."));
    try {
      await invoke("managed_turn_end", request);
    } catch (error) {
      throw new Error(`Managed turn could not finish: ${String(error)}`);
    }
  };
}
