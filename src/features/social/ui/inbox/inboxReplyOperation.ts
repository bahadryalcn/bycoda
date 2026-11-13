import type { SocialDraft, SocialJob, SocialJobsPage } from "../../model/social";

type RequestFn = <T>(
  action: string,
  input?: Record<string, unknown>,
  requestId?: string,
) => Promise<T>;
export type InboxReplyInput = {
  threadId: string;
  text: string;
  /** Verified fact IDs, empty for a manual reply. */
  factIds: string[];
};

/** One owner action, including retries. Never change its input or its request IDs. */
export type InboxReplyOperation = {
  input: InboxReplyInput;
  requests: { draft: string; approve: string; send: string; status: string };
  draft?: SocialDraft;
  approved?: boolean;
  sendAttempted?: boolean;
  queued?: boolean;
  job?: SocialJob;
  pending?: Promise<void>;
};

export function createInboxReplyOperation(input: InboxReplyInput): InboxReplyOperation {
  return {
    input: { ...input, factIds: [...input.factIds] },
    requests: {
      draft: crypto.randomUUID(),
      approve: crypto.randomUUID(),
      send: crypto.randomUUID(),
      status: crypto.randomUUID(),
    },
  };
}

/** Bounded read only reconciliation. Missing history never proves non-delivery. */
async function existingJob(call: RequestFn, operation: InboxReplyOperation) {
  if (operation.job) return call<SocialJob>("jobs.status", { id: operation.job.id });
  if (!operation.draft) return undefined;
  const result = await call<SocialJobsPage>("jobs.status", { page: true, offset: 0, limit: 100 });
  return result.jobs.find((job) => job.draftId === operation.draft!.id);
}

/** Receipt replay uses the exact request and reviewed draft; Host still owns every gate. */
export function resumeInboxReply(call: RequestFn, operation: InboxReplyOperation): Promise<void> {
  if (operation.pending) return operation.pending;
  if (operation.queued) return Promise.resolve();
  const run = async () => {
    if (!operation.draft) {
      operation.draft = await call<SocialDraft>(
        "replies.draft",
        operation.input,
        operation.requests.draft,
      );
    }
    if (!operation.approved) {
      await call(
        "drafts.approve",
        { id: operation.draft.id, reviewedDraft: operation.draft },
        operation.requests.approve,
      );
      operation.approved = true;
    }
    if (operation.sendAttempted) {
      // A failed lookup leaves the action unresolved. Do not turn it into a send.
      operation.job = await existingJob(call, operation);
    }
    if (!operation.job) {
      operation.sendAttempted = true;
      operation.job = await call<SocialJob>(
        "replies.send",
        { id: operation.draft.id },
        operation.requests.send,
      );
    }
    if (operation.job && ["failed", "cancelled", "review"].includes(operation.job.status)) return;
    operation.queued = true;
    await call(
      "inbox.setStatus",
      { threadId: operation.input.threadId, status: "replied" },
      operation.requests.status,
    ).catch(() => undefined);
  };
  operation.pending = run().finally(() => {
    operation.pending = undefined;
  });
  return operation.pending;
}
