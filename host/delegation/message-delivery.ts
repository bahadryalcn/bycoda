import type { HostSession } from "../../src/features/connections/model/protocol";
import type { SessionQueues } from "../sessions/session-queue";
import {
  sessionNeedsInput,
  type QueuedMessage,
  type SessionMessageAuthor,
} from "../../src/features/sessions/model/session";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { isSessionNotFound } from "../sessions/session-authority";
import type { AgentDelivery } from "./communication";
import type { DelegationDependencies } from "./service";

/** Reuses existing Work admission for children and shared queues for Native parents. */
export function agentMessageDelivery(
  deps: DelegationDependencies,
  continueChild: (message: AgentDelivery) => Promise<"started" | "waiting">,
) {
  return async (message: AgentDelivery): Promise<"started" | "steered" | "queued" | "waiting"> => {
    // Only a missing session means "no host session" (a Native parent); a transient read
    // error must surface instead of silently routing the message elsewhere.
    const target = await deps.engine.store.session(message.targetSessionId).catch((error) => {
      if (isSessionNotFound(error)) return undefined;
      throw error;
    });
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
      await deps.enqueueParent(
        message.targetSessionId,
        message.commandId,
        message.text,
        message.notice,
      );
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

/** Longest one child's notice section may be, and the longest a batched notice row may grow. */
export const NOTICE_SECTION_GRAPHEMES = 8_000;
export const NOTICE_ROW_CHARS = 60_000;
const NOTICE_SEPARATOR = "\n\n---\n\n";

/**
 * Append without replacing drafts, queue rows, owner pauses or a live drain lease.
 * A system notice joins an unclaimed notice row of the same reason at the queue's tail,
 * so one parent turn handles every notice that arrived while it was busy.
 */
export async function enqueueAgentParentMessage(
  queues: SessionQueues,
  sessionId: string,
  id: string,
  text: string,
  author?: SessionMessageAuthor,
) {
  for (let attempt = 0; ; attempt++) {
    const before = await queues.get(sessionId);
    if (before.messages.some((message) => message.id === id)) return;
    const section = author ? truncateGraphemes(text, NOTICE_SECTION_GRAPHEMES) : text;
    const tail = before.messages.at(-1);
    const mergeable =
      author?.kind === "delegation" &&
      tail?.author?.kind === "delegation" &&
      tail.author.reason === author.reason &&
      !tail.deliveryUnknown &&
      before.claim?.id !== tail.id &&
      before.editingId !== tail.id &&
      tail.text.length + NOTICE_SEPARATOR.length + section.length <= NOTICE_ROW_CHARS;
    const rows: QueuedMessage[] = mergeable
      ? [
          ...before.messages.slice(0, -1),
          { ...tail, text: `${tail.text}${NOTICE_SEPARATOR}${section}` },
        ]
      : [...before.messages, { id, text: section, attachments: [], ...(author ? { author } : {}) }];
    try {
      await queues.change(sessionId, before, {
        ...before,
        status: before.status ?? "active",
        messages: rows,
      });
      return;
    } catch (error) {
      // The tail was claimed or edited between the read and the write: look again.
      if (attempt >= 2) throw error;
    }
  }
}

export async function inspectAgentSession(deps: DelegationDependencies, id: string) {
  const snapshot: Pick<HostSession, "projectId" | "session"> & { status?: string } =
    await deps.engine.store.session(id).catch((error) => {
      // Only a missing host session falls back to the desktop copy; other errors propagate.
      if (!isSessionNotFound(error)) throw error;
      return deps.featureSession(id);
    });
  return {
    projectId: snapshot.projectId,
    runtimeMode: snapshot.session.runtimeMode,
    status: snapshot.status ?? (snapshot.session.busy ? "running" : "idle"),
  };
}
