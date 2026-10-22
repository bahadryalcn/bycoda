/**
 * Composer drafts, keyed by session id.
 *
 * SessionPane keeps the text you are typing in a React ref so retyping while
 * the pane stays mounted does not re-render on every keystroke. A plain ref
 * only lives as long as that one component instance though: closing a
 * session's pane (or moving it to another split) unmounts SessionPane, and
 * the ref - and whatever you had typed - is gone with no warning the moment
 * it remounts.
 *
 * This module-level map survives that, because it lives outside the React
 * tree for as long as the app process is running: the draft comes back when
 * the pane for that session opens again.
 *
 * Across an app restart it is the working copy of the saved drafts: the
 * store (data/composerDraftStore.ts) loads them in here before the first
 * render and listens for changes to write them back.
 */
import type { McpTag } from "./mcpPicker";
import { canRestoreOver } from "./draftPersistence";
import type { Attachment } from "./session";

const drafts = new Map<string, string>();
const mcpTags = new Map<string, McpTag[]>();
const attachments = new Map<string, Attachment[]>();
const modes = new Map<string, "save">();
const notices = new Map<string, string>();
const listeners = new Set<(sessionId: string) => void>();
let revision = 0;
const changedAt = new Map<string, number>();

/** Capture before an async restore so late work cannot overwrite a newer clear. */
export function composerDraftRevision(): number {
  return revision;
}

/** Called with the session id whenever its draft changes. Returns the unsubscribe. */
export function subscribeComposerDrafts(listener: (sessionId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(sessionId: string) {
  changedAt.set(sessionId, ++revision);
  for (const listener of listeners) listener(sessionId);
}

export function getComposerDraft(sessionId: string): string | undefined {
  return drafts.get(sessionId);
}

export function getComposerDraftMode(sessionId: string): "save" | undefined {
  return modes.get(sessionId);
}

export function setComposerDraftMode(sessionId: string, mode: "save" | undefined): void {
  if (modes.get(sessionId) === mode) return;
  if (mode) modes.set(sessionId, mode);
  else modes.delete(sessionId);
  changed(sessionId);
}

export function setComposerDraft(sessionId: string, text: string): void {
  if (text) {
    if (drafts.get(sessionId) === text) return;
    drafts.set(sessionId, text);
  } else {
    const had = drafts.delete(sessionId);
    if (!mcpTags.delete(sessionId) && !had) return;
  }
  changed(sessionId);
}

export function getComposerMcpTags(sessionId: string): McpTag[] {
  return mcpTags.get(sessionId) ?? [];
}

export function setComposerMcpTags(sessionId: string, tags: McpTag[]): void {
  if (tags.length > 0) {
    mcpTags.set(sessionId, tags);
  } else if (!mcpTags.delete(sessionId)) {
    return;
  }
  changed(sessionId);
}

/** Attachments are kept as plain data (no object URLs): the composer revokes those on unmount. */
export function getComposerAttachments(sessionId: string): Attachment[] {
  return attachments.get(sessionId) ?? [];
}
export function allComposerAttachmentIds(): string[] {
  return [...new Set([...attachments.values()].flatMap((files) => files.map((file) => file.id)))];
}

export function setComposerAttachments(sessionId: string, files: Attachment[]): void {
  if (files.length > 0) {
    attachments.set(sessionId, files);
  } else if (!attachments.delete(sessionId)) {
    return;
  }
  changed(sessionId);
}

/** A one-time line for the composer, e.g. that a restored draft lost an attachment. */
export function takeComposerNotice(sessionId: string): string | undefined {
  const notice = notices.get(sessionId);
  notices.delete(sessionId);
  return notice;
}

/**
 * Put a draft loaded from disk in place. Anything already here is from this
 * run and newer, so it is left alone. Returns whether the draft was used.
 */
export function restoreComposerDraft(
  sessionId: string,
  saved: {
    text: string;
    mcpTags: McpTag[];
    attachments: Attachment[];
    mode?: "save";
    notice?: string;
  },
  startedAt = revision,
): boolean {
  if ((changedAt.get(sessionId) ?? 0) > startedAt) return false;
  if (
    !canRestoreOver({
      text: drafts.get(sessionId),
      attachments: attachments.get(sessionId),
    })
  ) {
    return false;
  }
  if (saved.text) drafts.set(sessionId, saved.text);
  if (saved.mcpTags.length > 0) mcpTags.set(sessionId, saved.mcpTags);
  if (saved.attachments.length > 0) attachments.set(sessionId, saved.attachments);
  if (saved.mode) modes.set(sessionId, saved.mode);
  if (saved.notice) notices.set(sessionId, saved.notice);
  return true;
}

/** The whole draft for a session as it stands now. */
export function composerDraftOf(sessionId: string): {
  text: string;
  mcpTags: McpTag[];
  attachments: Attachment[];
  mode?: "save";
} {
  return {
    text: drafts.get(sessionId) ?? "",
    mcpTags: mcpTags.get(sessionId) ?? [],
    attachments: attachments.get(sessionId) ?? [],
    ...(modes.has(sessionId) ? { mode: modes.get(sessionId) } : {}),
  };
}

/** Typed text or an attachment that has not been sent. Whitespace alone is not a message. */
export function hasUnsentComposerDraft(sessionId: string): boolean {
  const draft = composerDraftOf(sessionId);
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}

export function clearComposerDraft(sessionId: string): void {
  drafts.delete(sessionId);
  mcpTags.delete(sessionId);
  attachments.delete(sessionId);
  modes.delete(sessionId);
  notices.delete(sessionId);
  changed(sessionId);
}
