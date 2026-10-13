import { invoke } from "@tauri-apps/api/core";
import { buildBudgetedHandoff, handoffHistory } from "../../features/sessions/model/handoffBudget";
import { modelContextWindow } from "../../features/sessions/model/models";
import type { Session } from "../../features/sessions/model/session";
import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import { hostFeatureRequest } from "../../features/connections/model/hostFeatureClient";

/** Persist on the owning machine before forgetting the outgoing provider session. */
export async function prepareBudgetedHandoff(
  session: Session,
  brief: string,
  request: string,
): Promise<string> {
  const history = handoffHistory(session);
  const archive = parseRemotePath(session.cwd)
    ? await hostFeatureRequest<{ path: string }>(
        session.cwd,
        "handoff-history-v1",
        "handoff_history_save",
        { history },
      )
    : await invoke<{ path: string }>("handoff_history_save", { history });
  return buildBudgetedHandoff(session, {
    contextWindow: modelContextWindow(session.model),
    request,
    brief,
    historyPath: archive.path,
  }).text;
}
