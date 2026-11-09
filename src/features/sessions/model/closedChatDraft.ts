import {
  HARNESS_LABEL,
  canReplaceSessionTitle,
  sessionDraftBlock,
  titleFromPrompt,
  type Attachment,
  type Session,
} from "./session";

/**
 * A blank chat closed with unsent composer text keeps that text as its saved
 * draft turn (the same turn "Save draft" creates). The draft makes the chat a
 * real conversation, so it is written to project history and stays listed
 * until the draft is sent or removed. Returns undefined when nothing changes:
 * no text or attachment, a busy chat, or a chat that already holds a draft.
 */
export function sessionWithClosedDraft(
  session: Session,
  draft: { text: string; attachments: Attachment[] },
): Session | undefined {
  if (session.busy || session.inboxAsk || session.worktreeRemoved) return undefined;
  if (sessionDraftBlock(session)) return undefined;
  if (!draft.text.trim() && draft.attachments.length === 0) return undefined;
  const title = canReplaceSessionTitle(
    session.title,
    session.harness,
    HARNESS_LABEL[session.harness],
  )
    ? titleFromPrompt(draft.text, session.harness, draft.attachments)
    : session.title;
  return {
    ...session,
    title,
    blocks: [
      ...session.blocks,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: draft.text,
        ...(draft.attachments.length > 0 ? { attachments: draft.attachments } : {}),
        draft: true,
      },
    ],
  };
}
