import { sameProjectPath } from "../../../features/projects/model/recents";
import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { sessionDraftBlock } from "../../../features/sessions/model/session";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { getSession } from "../../../features/sessions/data/sessionStore";
import type { AppControlRequestDeps } from "./useAppControlRequests";

/** Uses the same saved appRequestId owner as application session sends. */
export async function submitRoomSession(input: Record<string, unknown>, target: { projectCwd: string; valid: () => boolean } | undefined, authorize: () => Promise<boolean>, deps: Pick<AppControlRequestDeps, "ensureOpenSessionRef" | "submitSessionRef">) {
  const { requestId, sessionId, text } = input;
  if (Object.keys(input).some(key => !["requestId", "sessionId", "text"].includes(key)) || typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,300}$/.test(requestId) || typeof sessionId !== "string" || !sessionId || typeof text !== "string" || !text.trim() || text.length > 16000)
    throw new Error("Invalid Room session submission.");
  if (!target || !target.valid() || !(await authorize())) throw new Error("Assistant Room target or authority is unavailable.");
  const session = await deps.ensureOpenSessionRef.current(sessionId);
  if (!target.valid() || !(await authorize())) throw new Error("Assistant Room target or authority is unavailable.");
  if (!target.valid()) throw new Error("Assistant Room target or authority is unavailable.");
  if (!session || session.id !== sessionId || session.orchestrationLeadId || session.inboxAsk || orchestrator.run(sessionId) || !sameProjectPath(session.cwd, target.projectCwd) || hostSessionBinding(session) || remoteProjectFor(session.cwd))
    throw new Error("Session is unavailable as a local desktop target.");
  const previous = session.blocks.find(block => block.appRequestId === requestId);
  const confirm = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!target.valid() || !(await authorize())) throw new Error("Room submission outcome is unknown; inspect the original request.");
      const stored = await getSession(sessionId);
      if (!target.valid() || !(await authorize())) throw new Error("Room submission outcome is unknown; inspect the original request.");
      const block = stored?.blocks.find(item => item.appRequestId === requestId);
      if (block) {
        if (stored?.id !== sessionId || !sameProjectPath(stored.cwd, target.projectCwd) || block.role !== "user" || block.text !== text || block.draft) throw new Error("Request ID belongs to a different submission.");
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Room submission outcome is unknown; inspect the original request.");
  };
  if (previous) {
    if (previous.text !== text || previous.draft) throw new Error("Request ID belongs to a different submission.");
    await confirm();
    return { action: "workspace.sessions.submit", status: "accepted", requestId, sessionId, alreadySubmitted: true };
  }
  if (session.busy || sessionDraftBlock(session)) throw new Error("Session is busy or has an unsent draft.");
  const accepted = await deps.submitSessionRef.current(sessionId, text, [], { appRequestId: requestId });
  if (!accepted) throw new Error("Session could not accept the submission.");
  await confirm();
  return { action: "workspace.sessions.submit", status: "accepted", requestId, sessionId, alreadySubmitted: false };
}
