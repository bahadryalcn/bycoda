import type { UserQuestionReply } from "../../../features/sessions/model/userQuestion";
import type { HarnessEvent } from "../core/types";

export type QuestionDelivery = {
  sending?: boolean;
  event?: Extract<HarnessEvent, { type: "question.asked" }>;
  deliver?: (reply: UserQuestionReply) => Promise<void>;
};

export class QuestionReplyValidationError extends Error {}

/** Providers may have several child requests while the composer shows one at a time. */
export function showNextQueuedQuestion(live: {
  questions: Map<number, QuestionDelivery>;
  visibleQuestionId?: number;
  cancelled: boolean;
  muteUpdates: boolean;
  onEvent: (event: HarnessEvent) => void;
}): void {
  if (live.cancelled || live.muteUpdates) return;
  if (live.visibleQuestionId !== undefined && live.questions.has(live.visibleQuestionId)) return;
  const next = live.questions.entries().next().value;
  live.visibleQuestionId = next?.[0];
  if (next?.[1].event) live.onEvent(next[1].event);
}

/** A write failure can mean the reply reached the provider. Never resend it blindly. */
export function deliverQuestionReply(
  pending: QuestionDelivery,
  requestId: number,
  reply: UserQuestionReply,
  onEvent: (event: HarnessEvent) => void,
  current: () => boolean,
  accepted: () => void,
): void {
  const deliver = pending.deliver;
  if (pending.sending || !deliver) return;
  pending.sending = true;
  onEvent({ type: "question.updated", requestId, delivery: "sending" });
  void Promise.resolve()
    .then(() => {
      if (!current()) return false;
      return deliver(reply).then(() => true);
    })
    .then((sent) => {
      if (sent && current()) accepted();
    })
    .catch((error: unknown) => {
      if (!current()) return;
      const invalid = error instanceof QuestionReplyValidationError;
      if (invalid) pending.sending = false;
      onEvent({
        type: "question.updated",
        requestId,
        delivery: invalid ? "failed" : "unknown",
        error: invalid
          ? error.message
          : "Answer delivery could not be confirmed. Check the connection before continuing.",
      });
    });
}
