import { t } from "../../../shared/i18n";
export type VoiceJobHold =
  | "report"
  | "hours"
  | "budget"
  | "paused"
  | "noExecution"
  | "disabled"
  | "limits"
  | "noModel"
  | "dependency";
type ReceiptJob = { id: string; title: string; status: string };

const NEXT: Record<VoiceJobHold, string> = {
  report:
    "Jobs wait because the assistant is in report mode; the owner can switch to Jobs mode in Room settings.",
  hours:
    "Jobs wait because it is outside the assistant's working hours; they start when hours open.",
  budget:
    "Jobs wait because the assistant's budget is used up; the owner can raise it in Room settings.",
  paused: "Jobs wait because the assistant is paused; the owner can resume it in the Room.",
  noExecution:
    "Jobs wait because no execution model is selected; the owner can pick one in Room settings.",
  disabled:
    "Jobs wait because the assistant is turned off; the owner can turn it on in Room settings.",
  limits:
    "Jobs wait because every model in the pool is at its limit; they start after the limit resets.",
  noModel:
    "Jobs wait because no model in the pool can run them; the owner can add one in Room settings.",
  dependency:
    "A job waits for the job it was told to follow; it starts when that job is done, and stays queued if that job failed or was cancelled.",
};

/** Tool result for accepted jobs: states which started and why the others wait. */
export async function voiceJobReceipt(
  jobs: readonly ReceiptJob[],
  request: (input: {
    op: "snapshot";
    limit: number;
  }) => Promise<{ snapshot?: { jobHolds?: Record<string, VoiceJobHold> } }>,
) {
  // A failed read only loses the reason; the jobs are already accepted.
  const holds = await request({ op: "snapshot", limit: 100 }).then(
    (response) => response.snapshot?.jobHolds,
    () => undefined,
  );
  const rows = jobs.map((job) => {
    const started = ["planning", "running", "done"].includes(job.status);
    const holdReason = started ? undefined : holds?.[job.id];
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      started,
      ...(holdReason ? { holdReason } : {}),
    };
  });
  const waiting = rows.find((row) => !row.started);
  const next = !waiting
    ? "Jobs started."
    : waiting.holdReason
      ? NEXT[waiting.holdReason]
      : "Jobs are queued and start as soon as the assistant picks them up.";
  return { status: "accepted", jobs: rows, next };
}

type AcceptedJob = {
  kind?: string;
  status: string;
  quickResult?: { noteId?: string; automationId?: string };
};

/** Spoken summary after the owner starts jobs from the review. */
export function voiceJobsAcceptedSpeech(jobs: readonly AcceptedJob[]) {
  const project = jobs.filter((job) => job.kind !== "quick").length;
  const done = (key: "noteId" | "automationId") =>
    jobs.filter((job) => job.kind === "quick" && job.status === "done" && job.quickResult?.[key])
      .length;
  return t(
    project === 1
      ? "{p0} personal notes saved. {p1} automations created. 1 project job accepted."
      : "{p0} personal notes saved. {p1} automations created. {p2} project jobs accepted.",
    { p0: done("noteId"), p1: done("automationId"), p2: project },
  );
}
