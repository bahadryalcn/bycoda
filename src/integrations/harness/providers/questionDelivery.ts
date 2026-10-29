import type { UserQuestionReply } from "../../../features/sessions/model/userQuestion";
import type { HarnessEvent } from "../core/types";
import {
  getNativeOutputEventOrigin,
  retainNativeOutputEventOrigin,
  nativeOutputSink,
  trackNativeOutputWork,
  noteNativeOutputAdditionalInput,
} from "../core/nativeOutputDelivery";

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
  const origin = pending.event && getNativeOutputEventOrigin(pending.event);
  const work = origin ? retainNativeOutputEventOrigin(origin) : null;
  noteNativeOutputAdditionalInput(work);
  const emit = nativeOutputSink(work, onEvent);
  emit({ type: "question.updated", requestId, delivery: "sending" });
  const actual = Promise.resolve()
    .then(
      nativeOutputSink(work, () => {
        if (!current()) return false;
        return deliver(reply).then(() => true);
      }),
    )
    .then(
      nativeOutputSink(work, (sent) => {
        if (sent && current()) accepted();
        else work?.fail("question-reply-retired");
      }),
    );
  const handled = actual.catch(
    nativeOutputSink(work, (error: unknown) => {
      if (!current()) {
        work?.fail("question-reply-retired");
        return;
      }
      const invalid = error instanceof QuestionReplyValidationError;
      if (invalid) pending.sending = false;
      emit({
        type: "question.updated",
        requestId,
        delivery: invalid ? "failed" : "unknown",
        error: invalid
          ? error.message
          : "Answer delivery could not be confirmed. Check the connection before continuing.",
      });
      work?.fail("question-reply-failed");
    }),
  );
  void trackNativeOutputWork(handled, work).catch(() => undefined);
}
