export type InboxApprovalComment = {
  path: string;
  line: number;
  startLine?: number;
  side: string;
  body: string;
};

/** Structured preview native attaches to an Inbox write approval; the text message stays the record. */
export type InboxApprovalDetails = {
  action: "comment" | "review" | "pr-action";
  project: string;
  provider: string;
  target: string;
  replyTo?: string;
  thread?: string;
  body?: string;
  review?: { event: string; commitId: string; body: string; comments: InboxApprovalComment[] };
  prAction?: string;
  headSha?: string;
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const line = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

function comment(value: unknown): InboxApprovalComment | undefined {
  if (!isObject(value)) return undefined;
  const path = text(value.path);
  const at = line(value.line);
  const side = text(value.side);
  const body = text(value.body);
  if (!path || !at || !side || body === undefined) return undefined;
  const start = value.startLine == null ? undefined : line(value.startLine);
  if (value.startLine != null && !start) return undefined;
  return { path, line: at, side, body, ...(start ? { startLine: start } : {}) };
}

function review(value: unknown): InboxApprovalDetails["review"] | null {
  if (!isObject(value) || !Array.isArray(value.comments)) return null;
  const event = text(value.event);
  const commitId = text(value.commitId);
  const body = text(value.body);
  const comments = value.comments.map(comment);
  if (!event || !commitId || body === undefined || comments.some((item) => !item)) return null;
  return { event, commitId, body, comments: comments as InboxApprovalComment[] };
}

/**
 * Accepts only the exact shape native sends. Any mismatch drops the preview and the dialog
 * falls back to the plain message, so a malformed preview can never hide what is approved.
 */
export function parseInboxApprovalDetails(value: unknown): InboxApprovalDetails | undefined {
  if (!isObject(value) || value.kind !== "inbox") return undefined;
  const action = value.action;
  if (action !== "comment" && action !== "review" && action !== "pr-action") return undefined;
  const project = text(value.project);
  const provider = text(value.provider);
  const target = text(value.target);
  if (!project || !provider || !target) return undefined;
  const details: InboxApprovalDetails = { action, project, provider, target };
  const replyTo = text(value.replyTo);
  const thread = text(value.thread);
  if (replyTo) details.replyTo = replyTo;
  if (thread) details.thread = thread;
  if (action === "comment") {
    const body = text(value.body);
    if (!body) return undefined;
    details.body = body;
  } else if (action === "review") {
    const parsed = review(value.review);
    if (!parsed) return undefined;
    details.review = parsed;
  } else {
    const prAction = text(value.prAction);
    if (!prAction) return undefined;
    details.prAction = prAction;
    const head = text(value.headSha);
    if (head) details.headSha = head;
  }
  return details;
}
