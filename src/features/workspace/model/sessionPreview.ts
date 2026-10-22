import {
  getComposerAttachments,
  getComposerDraft,
  getComposerMcpTags,
} from "../../sessions/model/draftCache";
import { getSessions } from "../../sessions/model/sessionsStore";
import type { Session } from "../../sessions/model/session";
import { sameProjectPath } from "../../projects/model/recents";
import { leafIds, newTab, type WorkspaceTab } from "./layout";

export function hasSessionDraft(id: string): boolean {
  return (
    !!getComposerDraft(id) ||
    getComposerAttachments(id).length > 0 ||
    getComposerMcpTags(id).length > 0
  );
}

export function keepSessionTab(tab: WorkspaceTab): WorkspaceTab {
  if (!tab.previewSessionId) return tab;
  const { previewSessionId: _preview, ...kept } = tab;
  return kept;
}

/** A split, editor or terminal is intentional workspace composition. */
export function isSessionPreview(tab: WorkspaceTab): boolean {
  return (
    !!tab.previewSessionId &&
    !tab.diffOpen &&
    leafIds(tab.layout).length === 1 &&
    leafIds(tab.layout)[0] === tab.previewSessionId &&
    tab.editorPanes.every((pane) => pane.files.length === 0) &&
    (tab.terminalPanes ?? []).every((pane) => pane.files.length === 0)
  );
}

export function sessionNeedsKeptTab(session: Session | undefined): boolean {
  return (
    !!session &&
    (session.busy || hasSessionDraft(session.id) || session.blocks.some((block) => block.draft))
  );
}

export function normalizeSessionPreview(tab: WorkspaceTab): WorkspaceTab {
  if (!tab.previewSessionId) return tab;
  return !isSessionPreview(tab) ||
    sessionNeedsKeptTab(getSessions().find((session) => session.id === tab.previewSessionId))
    ? keepSessionTab(tab)
    : tab;
}

/** Reuse only this project's browsing slot, retaining its position and tab identity. */
export function openSessionPreview(
  tabs: WorkspaceTab[],
  session: Session,
  sessions: readonly Session[],
): { tabs: WorkspaceTab[]; tab: WorkspaceTab } | undefined {
  const normalized = tabs.map(normalizeSessionPreview);
  const previous = normalized.find(
    (tab) =>
      isSessionPreview(tab) &&
      sameProjectPath(
        sessions.find((entry) => entry.id === tab.previewSessionId)?.cwd ?? "",
        session.cwd,
      ),
  );
  if (!previous) return undefined;
  const tab = {
    ...newTab(session.id),
    id: previous.id,
    ...(previous.groupId ? { groupId: previous.groupId } : {}),
    ...(sessionNeedsKeptTab(session) ? {} : { previewSessionId: session.id }),
  };
  return { tabs: normalized.map((entry) => (entry.id === previous.id ? tab : entry)), tab };
}
