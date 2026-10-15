import { projectKey } from "../../shared/lib/paths";
import { readFlag, writeFlag } from "../settings/model/storageFlags";
import type { Note, NoteMetadata } from "./notes";

/** Registry name of the command that toggles the session notes panel. */
export const NOTES_PANEL_COMMAND = "Session: Toggle Notes Panel";

const OPEN_KEY = "bycoda.notesPanelOpen";
const WIDTH_KEY = "bycoda.notesPanelWidth";

export const NOTES_PANEL_MIN_WIDTH = 260;
export const NOTES_PANEL_MAX_WIDTH = 560;
export const NOTES_PANEL_DEFAULT_WIDTH = 340;

export function notesPanelMaxWidth(viewportWidth: number): number {
  return Math.max(
    NOTES_PANEL_MIN_WIDTH,
    Math.min(NOTES_PANEL_MAX_WIDTH, Math.round(viewportWidth * 0.5)),
  );
}

export function clampNotesPanelWidth(value: number, viewportWidth: number): number {
  if (!Number.isFinite(value)) return NOTES_PANEL_DEFAULT_WIDTH;
  return Math.min(
    notesPanelMaxWidth(viewportWidth),
    Math.max(NOTES_PANEL_MIN_WIDTH, Math.round(value)),
  );
}

export function parseNotesPanelWidth(raw: string | null): number {
  const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : NOTES_PANEL_DEFAULT_WIDTH;
}

export function loadNotesPanelWidth(): number {
  try {
    return parseNotesPanelWidth(localStorage.getItem(WIDTH_KEY));
  } catch {
    return NOTES_PANEL_DEFAULT_WIDTH;
  }
}

export function saveNotesPanelWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // private mode / quota
  }
}

const listeners = new Set<() => void>();
const FOCUS_REQUEST_TTL_MS = 1000;
let focusRequestedAt = -Infinity;

export function getNotesPanelOpen(): boolean {
  return readFlag(OPEN_KEY) ?? false;
}

export function setNotesPanelOpen(open: boolean, now = Date.now()) {
  if (getNotesPanelOpen() === open) return;
  writeFlag(OPEN_KEY, open);
  // Only an explicit open moves focus into the editor, not a pane that merely
  // regains focus while the panel is already open.
  if (open) focusRequestedAt = now;
  for (const listener of [...listeners]) listener();
}

export function toggleNotesPanel() {
  setNotesPanelOpen(!getNotesPanelOpen());
}

export function subscribeNotesPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether an explicit open is waiting for a panel to take editor focus. */
export function notesPanelFocusRequested(now = Date.now()): boolean {
  return now - focusRequestedAt <= FOCUS_REQUEST_TTL_MS;
}

/** True once per explicit open, so the panel that mounts for it can take focus. */
export function takeNotesPanelFocusRequest(now = Date.now()): boolean {
  const pending = notesPanelFocusRequested(now);
  focusRequestedAt = -Infinity;
  return pending;
}

type ToggleContext = {
  enabled: boolean;
  activeTabId: string;
  tabs: readonly { id: string; focusedId: string; diffFocused?: boolean }[];
  sessions: readonly { id: string }[];
  projectTerminalFocused: boolean;
  surfaceOpen: boolean;
  /** The key press happened inside a session pane or its notes panel. */
  inSessionArea: boolean;
};

/** Whether a session view owns the key press, so the panel shortcut applies. */
export function shouldToggleNotesPanel(context: ToggleContext): boolean {
  if (
    !context.enabled ||
    context.projectTerminalFocused ||
    context.surfaceOpen ||
    !context.inSessionArea
  )
    return false;
  const tab = context.tabs.find((entry) => entry.id === context.activeTabId);
  if (!tab || tab.diffFocused) return false;
  return context.sessions.some((entry) => entry.id === tab.focusedId);
}

export type PanelNotes<NoteItem extends NoteMetadata = Note> = {
  /** Notes created for this session, newest first. */
  session: NoteItem[];
  /** The rest of the project's notes, newest first. */
  project: NoteItem[];
};

function newestFirst(a: NoteMetadata, b: NoteMetadata): number {
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/**
 * Notes the panel offers for a session: those linked to it first, then the
 * other notes saved from the same project. Remote projects compare by their
 * full remote path, exactly as the Notes screen stores them.
 */
export function panelNotes<NoteItem extends NoteMetadata>(
  notes: readonly NoteItem[],
  sessionId: string,
  cwd: string,
): PanelNotes<NoteItem> {
  const key = cwd ? projectKey(cwd) : "";
  const session: NoteItem[] = [];
  const project: NoteItem[] = [];
  for (const note of notes) {
    if (note.sourceSessionId === sessionId) session.push(note);
    else if (key && note.sourceCwd && projectKey(note.sourceCwd) === key) {
      project.push(note);
    }
  }
  return {
    session: session.sort(newestFirst),
    project: project.sort(newestFirst),
  };
}

/**
 * The note to show: the one last used here if it is still offered, then the
 * session's newest note. Project notes are only opened by explicit selection.
 */
export function pickPanelNote<NoteItem extends NoteMetadata>(
  offered: PanelNotes<NoteItem>,
  preferredId?: string | null,
): NoteItem | null {
  const all = [...offered.session, ...offered.project];
  return (
    (preferredId ? all.find((note) => note.id === preferredId) : undefined) ??
    offered.session[0] ??
    null
  );
}
