import type { HostSession } from "../../src/features/connections/model/protocol";
import type { SessionQueues } from "../sessions/session-queue";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";
import type { AgentDelivery } from "./communication";
import type { DelegationDependencies } from "./service";

/** Reuses existing Work admission for children and shared queues for Native parents. */
export function agentMessageDelivery(
  deps: DelegationDependencies,
  continueChild: (message: AgentDelivery) => Promise<"started" | "waiting">,
) {
  return async (message: AgentDelivery): Promise<"started" | "steered" | "queued" | "waiting"> => {
    const target = await deps.engine.store.session(message.targetSessionId).catch(() => undefined);
    // Work owns task/goal/automation continuation. A generic owner queue cannot
    // manufacture an unbudgeted turn from a child result.
    const workParent = !message.target && !!message.source?.rootWorkId;
    if (workParent && target?.status !== "running")
      throw new Error(
        "Unattended parent continuation requires its Work owner; wait for child results in the parent turn.",
      );
    if (workParent && message.mode === "queue") return "waiting";
    const queueParent = async () => {
      if (!deps.enqueueParent) throw new Error("Parent message delivery is unavailable.");
      await deps.enqueueParent(message.targetSessionId, message.commandId, message.text);
      return "queued" as const;
    };
    if (
      !message.target &&
      message.mode !== "steer" &&
      (message.mode === "queue" ||
        !target ||
        target.status !== "running" ||
        sessionNeedsInput(target.session))
    )
      return queueParent();
    if (target && sessionNeedsInput(target.session)) return "waiting";
    if (target?.status === "running") {
      if (message.mode === "queue") return "waiting";
      try {
        await deps.engine.command({
          type: "steer",
          commandId: message.commandId,
          sessionId: message.targetSessionId,
          runId: target.runId!,
          text: message.text,
        });
        return "steered";
      } catch (error) {
        // These engine refusals precede persistence/provider submission. Nothing was offered.
        if (
          message.mode === "auto" &&
          error instanceof Error &&
          ["This provider cannot steer an active turn", "This turn was stopped"].includes(
            error.message,
          )
        )
          return message.target || workParent ? "waiting" : queueParent();
        throw error;
      }
    }
    if (message.mode === "steer") throw new Error("Recipient has no active Host turn to steer.");
    if (message.target) {
      return continueChild(message);
    }
    return queueParent();
  };
}

/** Append without replacing drafts, queue rows, owner pauses or a live drain lease. */
export async function enqueueAgentParentMessage(
  queues: SessionQueues,
  sessionId: string,
  id: string,
  text: string,
) {
  const before = await queues.get(sessionId);
  if (before.messages.some((message) => message.id === id)) return;
  const row = { id, text, attachments: [] };
  await queues.change(sessionId, before, {
    ...before,
    status: before.status ?? "active",
    messages: [...before.messages, row],
  });
}

export async function inspectAgentSession(deps: DelegationDependencies, id: string) {
  const snapshot: Pick<HostSession, "projectId" | "session"> & { status?: string } =
    await deps.engine.store.session(id).catch(() => deps.featureSession(id));
  return {
    projectId: snapshot.projectId,
    runtimeMode: snapshot.session.runtimeMode,
    status: snapshot.status ?? (snapshot.session.busy ? "running" : "idle"),
  };
}
