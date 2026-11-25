/** An unanswered job review releases its tool call after the longest question timeout. */
export const VOICE_JOB_REVIEW_TIMEOUT_MS = 600_000;

/**
 * What an expired review does. An untouched review closes: nothing was created. A review that
 * shows a failed or partial start stays visible for the owner and only releases its tool call.
 * A start in progress is left to finish.
 */
export function voiceJobReviewExpiry(
  review: { busy: boolean; accepted: readonly string[]; error: string },
  released: boolean,
): "close" | "release" | "keep" {
  if (review.busy) return "keep";
  if (!review.accepted.length && !review.error) return "close";
  return released ? "keep" : "release";
}

/** The tool result of a review that expired untouched. */
export const VOICE_JOB_REVIEW_NO_ANSWER = {
  status: "cancelled",
  reason: "no_answer",
  error: "The owner did not answer the job review in time. Nothing was created.",
  next: "Tell the owner the review expired and nothing was started. Propose the jobs again only if they ask.",
} as const;

/** Spoken update when a review whose tool call was already answered expires or is closed. */
export function voiceJobReviewClosedUpdate(reason: "expired" | "reconnected") {
  return reason === "expired"
    ? "The job review the owner did not answer has expired. No jobs were created from it."
    : "The voice connection dropped while jobs waited for the owner's review. The review stays open; pressing Start still creates exactly the reviewed jobs, and no job exists until then.";
}
