import type { HostStore } from "../../store";
import type { AssistantPorts } from "../service";
import type { AssistantActionJournal } from "./assistant-action-journal";

/** One retained request identity per actual autonomous session port, including manual supervision. */
export function journalAssistantSessionPorts(
  store: HostStore,
  journal: AssistantActionJournal,
  ports: AssistantPorts,
) {
  function wrap<
    T extends { sessionId: string; requestId: string; jobId?: string; supervisionId?: string },
    R,
  >(
    action: string,
    execute: ((input: T) => Promise<R>) | undefined,
    acknowledged: "completed" | "submitted" = "completed",
  ) {
    if (!execute) return undefined;
    return async (input: T): Promise<R> => {
      const record = await store.session(input.sessionId);
      const result = await journal.runAutonomous(
        {
          operationId: input.requestId,
          action,
          target: input.sessionId,
          projectIds: [record.projectId],
          ...(input.jobId ? { jobId: input.jobId } : {}),
          ...(input.supervisionId ? { supervisionId: input.supervisionId } : {}),
          payload: input,
        },
        async () => {
          const value = await execute(input);
          const state =
            value && typeof value === "object" && "state" in value ? value.state : acknowledged;
          return { value, state };
        },
      );
      return result.value;
    };
  }
  ports.manageSession = wrap("sessions.manage", ports.manageSession);
  ports.manageManualSession = wrap("sessions.manageManual", ports.manageManualSession);
  ports.answerSession = wrap("sessions.answer", ports.answerSession, "submitted");
}
