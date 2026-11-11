import { randomUUID } from "node:crypto";

import {
  NO_VERDICT,
  parseReviewVerdict,
  type HostTask,
  type TaskOwnerNotice,
} from "../../src/features/tasks/model/hostTasks";
import { HOST_INTERRUPTED, STOPPED_BY_USER } from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import { RUNTIME_RETRY_NOTICE } from "./constants";
import { QUESTION_NOTICE } from "./constants";
import { REVIEW_RERUN_NOTICE } from "./constants";
/** The verdict of the reviewer's last turn: from its latest message that
 * ends with one, since a short message may follow the verdict. */
export function reviewerVerdict(
  blocks: Awaited<ReturnType<HostStore["session"]>>["session"]["blocks"],
): ReturnType<typeof parseReviewVerdict> {
  return parseReviewVerdict(reviewerReply(blocks));
}

export function reviewerReply(
  blocks: Awaited<ReturnType<HostStore["session"]>>["session"]["blocks"],
): string {
  const lastUser = blocks.findLastIndex((block) => block.role === "user");
  const replies = blocks
    .slice(lastUser + 1)
    .filter((block) => block.role === "assistant" && block.text.trim());
  for (let at = replies.length - 1; at >= 0; at--) {
    const reply = replies[at];
    const review = parseReviewVerdict(reply.text);
    if (review.note !== NO_VERDICT)
      return replies
        .slice(0, at + 1)
        .map((block) => block.text)
        .join("\n\n");
  }
  return "";
}

/** One short plain sentence for an owner notice. */
export function noticeText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const sentence = line.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? line;
  return sentence.length > 240 ? `${sentence.slice(0, 237).trimEnd()}...` : sentence;
}

export function ownerNotice(
  kind: TaskOwnerNotice["kind"],
  message: string,
  at: number,
  id?: string,
) {
  return { id: id ?? randomUUID(), kind, message: noticeText(message), at } as TaskOwnerNotice;
}

/** A worker run succeeded and left a usable failed review or check result. */
export function completableWithFindings(task: HostTask): boolean {
  if (task.crewRunId || task.mergeRepair || task.reviewOnly || !task.sessionId) return false;
  const { review, command } = task.verification ?? {};
  return Boolean(
    (review?.verdict === "fail" && review.note !== NO_VERDICT) ||
    (command && !command.timedOut && command.exitCode !== null && command.exitCode !== 0),
  );
}

export function completionNotices(
  task: HostTask,
  error: string,
  now: number,
  reason: "external" | "no_progress" | "limit",
): TaskOwnerNotice[] {
  const open = (task.reviewNotes ?? []).filter(
    (note) => note.kind === "finding" && note.resolvedAt === undefined,
  );
  const notices = open.map((note) =>
    note.category === "external"
      ? ownerNotice("external_check", note.suggestion ?? note.finding, now)
      : ownerNotice("remaining_finding", note.finding, now),
  );
  const command = task.verification?.command;
  if (command && !command.timedOut && command.exitCode !== 0)
    notices.push(
      ownerNotice(
        "remaining_finding",
        `The check command still fails (exit code ${command.exitCode}).`,
        now,
      ),
    );
  if (!notices.length)
    notices.push(ownerNotice("remaining_finding", error.replace(/^Review failed:\s*/, ""), now));
  const external = open.length > 0 && open.every((note) => note.category === "external");
  notices.push(
    ownerNotice(
      "auto_continued",
      reason === "external" || (external && !command)
        ? "Finished without the external checks listed; run them before relying on this work."
        : reason === "no_progress"
          ? "Automatic correction stopped making progress, so the task finished with the open findings listed."
          : `Automatic correction reached its limit after ${task.repairAttempts ?? 0} attempts, so the task finished with the open findings listed.`,
      now,
    ),
  );
  return notices;
}

/** Provider, network and session failures that a fresh attempt can overcome.
 * Owner stops, budgets, limits, permission/credential gates and host stops are not. */
export function isTransientRunFailure(task: HostTask, error: string | undefined): boolean {
  if (task.error || !error || error === HOST_INTERRUPTED || error === STOPPED_BY_USER) return false;
  if (error === "The run's session was deleted.") return false;
  return !/permission|approv|denied|credential|unauthori[sz]ed|forbidden|budget|billing|sign(?:ed)?[- ]?(?:in|out)|log(?:ged)?[- ]?(?:in|out)|api key|persist|time limit|run limit/i.test(
    error,
  );
}

export function runtimeRetryCount(task: HostTask): number {
  return (task.ownerNotices ?? []).filter((notice) => notice.id.startsWith(RUNTIME_RETRY_NOTICE))
    .length;
}

export function reviewRerunCount(task: HostTask): number {
  return (task.ownerNotices ?? []).filter((notice) => notice.id.startsWith(REVIEW_RERUN_NOTICE))
    .length;
}

export function questionContinuationCount(task: HostTask): number {
  return (task.ownerNotices ?? []).filter((notice) => notice.id.startsWith(QUESTION_NOTICE)).length;
}
