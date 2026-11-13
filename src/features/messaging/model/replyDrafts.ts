/**
 * Reply drafts per thread, kept in memory for this app run so switching threads or
 * Inbox tabs never loses typed text.
 *
 * `requestId` identifies one send: a retry of the same text reuses it so the native
 * side can drop a duplicate when an earlier attempt was delivered but its answer lost.
 * Edited text after a failure is a new send and gets a new id.
 */
export type ReplyDraft = { body: string; requestId: string | null; sentBody: string | null };

const EMPTY: ReplyDraft = { body: "", requestId: null, sentBody: null };
const MAX_DRAFTS = 200;
const drafts = new Map<string, ReplyDraft>();

export function replyDraftKey(accountId: string, threadId: string): string {
  return JSON.stringify([accountId, threadId]);
}

export function readReplyDraft(key: string): ReplyDraft {
  return drafts.get(key) ?? EMPTY;
}

function store(key: string, draft: ReplyDraft) {
  drafts.delete(key);
  if (!draft.body && !draft.requestId) return;
  drafts.set(key, draft);
  // shortcut: oldest-first eviction bounds memory; upgrade to persisted drafts if users ask for them.
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
}

export function writeReplyDraftBody(key: string, body: string): ReplyDraft {
  const next = { ...readReplyDraft(key), body };
  store(key, next);
  return next;
}

/** Pure: the draft to store for sending `body`, reusing the id when this text was already attempted. */
export function prepareReplySend(
  draft: ReplyDraft,
  body: string,
  createId: () => string,
): ReplyDraft {
  if (draft.requestId && draft.sentBody === body) return draft;
  return { ...draft, requestId: createId(), sentBody: body };
}

/** Records the attempt before the native call so a retry finds the same id. */
export function beginReplySend(key: string, body: string, createId = () => crypto.randomUUID()) {
  const next = prepareReplySend(readReplyDraft(key), body, createId);
  store(key, next);
  return next.requestId as string;
}

/** A send receipt clears only its exact attempted snapshot, never a newer remounted editor. */
export function clearReplyDraft(key: string, attempted?: ReplyDraft): boolean {
  if (attempted && readReplyDraft(key) !== attempted) return false;
  drafts.delete(key);
  return true;
}

export function resetReplyDraftsForTests(): void {
  drafts.clear();
}
