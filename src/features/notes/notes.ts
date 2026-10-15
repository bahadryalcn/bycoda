import { projectDisplayName } from "../projects/model/projectNames";
import { invoke } from "@tauri-apps/api/core";
import { fuzzyMatch } from "../../shared/lib/fuzzy";
import type { ProjectFile } from "../../platform/tauri/fs";
import type { RankedFile } from "../files/model/fileIndex";

import { looksLikeProject } from "../projects/model/recents";

export const NOTE_MENTION_PREFIX = "note/";
export const NOTE_PATH_PREFIX = "note:";

export type Note = {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  sourceSessionId?: string;
  sourceCwd?: string;
  /** Generated for a blank title; finalized once when title editing finishes. */
  slugPending?: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Browsing and mention pickers never need an entire note body. */
export type NoteMetadata = Omit<Note, "body">;
export type NoteSummary = NoteMetadata & { preview: string };

export function summarizeNote(note: Note | NoteSummary): NoteSummary {
  const { body, preview, ...metadata } = note as Note & Partial<NoteSummary>;
  return { ...metadata, preview: notePreview(body ?? preview ?? "", note.title) };
}

export type NoteUpsert = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  sourceSessionId?: string;
  /** Omit on update to keep the saved project directory. */
  sourceCwd?: string;
  finalizeSlug?: boolean;
};

/** Note chip shown in the composer and on the user turn in the thread. */
export type NoteCardMeta = {
  id: string;
  slug: string;
  title: string;
  sourceCwd?: string;
};

/** Composer chip: display fields plus the body injected into the harness prompt. */
export type NoteComposerCard = NoteCardMeta & {
  body: string;
};

export function noteCardMeta(card: NoteComposerCard): NoteCardMeta {
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    ...(card.sourceCwd ? { sourceCwd: card.sourceCwd } : {}),
  };
}

export const ADD_NOTE_TO_CHAT_EVENT = "bycoda:add-note-to-chat";
export const NOTES_CHANGED_EVENT = "bycoda:notes-changed";

const MAX_TITLE = 200;
export const MAX_NOTE_TAGS = 20;
export const MAX_NOTE_TAG_LENGTH = 48;
const MAX_NOTE_PICKER = 8;
const NOTE_SLUG_RE = /(^|\s)@note\/([A-Za-z0-9_-]+)/g;

let cache: Note[] | null = null;
let inflight: Promise<Note[]> | null = null;
// Retain the newest outcome for superseded callers, including its rejection.
let latestRequest: Promise<Note[]> | null = null;
let generation = 0;
let summaryCache: NoteSummary[] | null = null;
let summaryInflight: Promise<NoteSummary[]> | null = null;
let latestSummaryRequest: Promise<NoteSummary[]> | null = null;
let summaryGeneration = 0;
// Only selected/referenced notes have bodies in this bounded cache.
const detailCache = new Map<string, Note>();
const detailInflight = new Map<string, Promise<Note | null>>();
const MAX_CACHED_NOTE_BODIES = 8;

function cacheNoteDetail(note: Note) {
  detailCache.delete(note.id);
  detailCache.set(note.id, note);
  while (detailCache.size > MAX_CACHED_NOTE_BODIES)
    detailCache.delete(detailCache.keys().next().value!);
}

export function peekNoteDetail(id: string, updatedAt: number): Note | null {
  const note = detailCache.get(id);
  return note?.updatedAt === updatedAt ? note : null;
}

export function peekNoteSummaries(): NoteSummary[] | null {
  return summaryCache;
}

export function peekNotes(): Note[] | null {
  return cache;
}

export function invalidateNotes() {
  generation += 1;
  cache = null;
  inflight = null;
  latestRequest = null;
  summaryGeneration += 1;
  summaryCache = null;
  summaryInflight = null;
  latestSummaryRequest = null;
  detailCache.clear();
  detailInflight.clear();
}

export async function loadNotes(refresh = false): Promise<Note[]> {
  if (!refresh && cache) return cache;
  if (!refresh && inflight) return inflight;

  const requestGeneration = ++generation;
  const promise = invoke<Note[]>("notes_list")
    .then(
      (notes) => {
        if (requestGeneration !== generation) return latestRequest ?? loadNotes(refresh);
        cache = notes;
        for (const note of notes.slice(0, MAX_CACHED_NOTE_BODIES)) cacheNoteDetail(note);
        summaryCache = notes.map(summarizeNote);
        return notes;
      },
      (error: unknown) => {
        if (requestGeneration !== generation) return latestRequest ?? loadNotes(refresh);
        // Background mention pickers retain their fallback; list screens report failures.
        if (refresh) throw error;
        return cache ?? [];
      },
    )
    .finally(() => {
      if (inflight === promise) inflight = null;
    });
  inflight = promise;
  latestRequest = promise;
  return promise;
}

/** The legacy full-list API stays available; all browsing uses this bounded payload. */
export async function loadNoteSummaries(refresh = false): Promise<NoteSummary[]> {
  if (!refresh && summaryCache) return summaryCache;
  if (!refresh && summaryInflight) return summaryInflight;
  const requestGeneration = ++summaryGeneration;
  const promise = invoke<(NoteSummary | Note)[]>("notes_list_summaries")
    .then(
      (values) => {
        if (requestGeneration !== summaryGeneration)
          return latestSummaryRequest ?? loadNoteSummaries(refresh);
        // Older runtimes/fixtures may supply a full row. Keep that body out of
        // list state, but allow the selected editor to reuse it safely.
        for (const value of values.slice(0, MAX_CACHED_NOTE_BODIES))
          if ("body" in value) cacheNoteDetail(value);
        summaryCache = values.map(summarizeNote);
        return summaryCache;
      },
      (error: unknown) => {
        if (requestGeneration !== summaryGeneration)
          return latestSummaryRequest ?? loadNoteSummaries(refresh);
        if (refresh) throw error;
        return summaryCache ?? [];
      },
    )
    .finally(() => {
      if (summaryInflight === promise) summaryInflight = null;
    });
  summaryInflight = promise;
  latestSummaryRequest = promise;
  return promise;
}

/** Search runs beside the body index, returning IDs rather than body bytes. */
export function searchNotes(query: string): Promise<string[]> {
  return invoke<string[]>("notes_search", { query });
}

export async function getNote(id: string): Promise<Note | null> {
  const existing = detailInflight.get(id);
  if (existing) return existing;
  const requestGeneration = summaryGeneration;
  const promise = invoke<Note | null>("notes_get", { id })
    .then((note) => {
      if (note && requestGeneration === summaryGeneration) cacheNoteDetail(note);
      return note;
    })
    .finally(() => {
      if (detailInflight.get(id) === promise) detailInflight.delete(id);
    });
  detailInflight.set(id, promise);
  return promise;
}

export async function upsertNote(note: NoteUpsert): Promise<Note> {
  const saved = await invoke<Note>("notes_upsert", { note });
  const previous = cache;
  const previousSummaries = summaryCache;
  invalidateNotes();
  if (previous) cache = [saved, ...previous.filter((item) => item.id !== saved.id)];
  if (previousSummaries)
    summaryCache = [
      summarizeNote(saved),
      ...previousSummaries.filter((item) => item.id !== saved.id),
    ];
  cacheNoteDetail(saved);
  return saved;
}

export async function deleteNote(id: string): Promise<void> {
  await invoke("notes_delete", { id });
  const previous = cache;
  const previousSummaries = summaryCache;
  invalidateNotes();
  if (previous) cache = previous.filter((item) => item.id !== id);
  if (previousSummaries) summaryCache = previousSummaries.filter((item) => item.id !== id);
}

/** Explicitly associate an existing note with a session; ordinary saves preserve it. */
export async function linkNoteToSession(id: string, sessionId: string): Promise<Note> {
  const saved = await invoke<Note>("notes_link_session", { id, sessionId });
  const previous = cache;
  const previousSummaries = summaryCache;
  invalidateNotes();
  if (previous) cache = previous.map((item) => (item.id === id ? saved : item));
  if (previousSummaries)
    summaryCache = previousSummaries.map((item) => (item.id === id ? summarizeNote(saved) : item));
  cacheNoteDetail(saved);
  return saved;
}

export async function createNote(input: {
  title?: string;
  body?: string;
  tags?: string[];
  sourceSessionId?: string;
  sourceCwd?: string;
}): Promise<Note> {
  const body = (input.body ?? "").replace(/\r\n?/g, "\n");
  return upsertNote({
    id: crypto.randomUUID(),
    title: (input.title ?? noteTitle(body)).slice(0, MAX_TITLE),
    body,
    tags: normalizeNoteTags(input.tags ?? []),
    ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
    ...(input.sourceCwd ? { sourceCwd: input.sourceCwd } : {}),
  });
}

/** Canonical, case-insensitive tags for storage and filtering. */
export function normalizeNoteTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const input of tags) {
    const tag = input
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, MAX_NOTE_TAG_LENGTH)
      .replace(/-+$/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length === MAX_NOTE_TAGS) break;
  }
  return normalized;
}

export function isNoteMentionPath(path: string): boolean {
  return path.startsWith(NOTE_PATH_PREFIX);
}

export function noteMentionLabel(note: NoteMetadata): string {
  return `${NOTE_MENTION_PREFIX}${note.slug}`;
}

export function notesAsProjectFiles(notes: readonly NoteMetadata[]): ProjectFile[] {
  return notes.map((note) => ({
    name: note.title,
    path: `${NOTE_PATH_PREFIX}${note.id}`,
    relative: noteMentionLabel(note),
  }));
}

export function rankNoteFiles(
  notes: readonly NoteMetadata[],
  query: string,
  limit = MAX_NOTE_PICKER,
): RankedFile[] {
  const needle = query.replace(/\/+$/, "").trim().toLowerCase();
  if (!needle) {
    return [...notes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((note) => ({
        ...notesAsProjectFiles([note])[0]!,
        score: 0,
        positions: [],
      }));
  }

  const scored: { note: NoteMetadata; score: number; positions: number[] }[] = [];
  for (const note of notes) {
    const titleHit = fuzzyMatch(needle, note.title);
    const slugHit = titleHit ? null : fuzzyMatch(needle, note.slug);
    const tagHit =
      titleHit || slugHit
        ? null
        : note.tags.map((tag) => fuzzyMatch(needle.replace(/^#/, ""), tag)).find(Boolean);
    const hit = titleHit ?? slugHit ?? tagHit;
    if (!hit) continue;
    scored.push({
      note,
      score: titleHit ? hit.score + 400 : tagHit ? hit.score + 200 : hit.score,
      positions: titleHit ? hit.positions : [],
    });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.note.updatedAt - a.note.updatedAt;
  });
  return scored.slice(0, limit).map((row) => ({
    ...notesAsProjectFiles([row.note])[0]!,
    score: row.score,
    positions: row.positions,
  }));
}

/** First markdown heading, or the first non-empty prose line. */
export function noteTitle(text: string): string {
  const heading = text.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
  if (heading) {
    const title = unwrapMarkdown(heading[1]).slice(0, MAX_TITLE);
    if (title) return title;
  }
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const title = unwrapMarkdown(trimmed).slice(0, MAX_TITLE);
    if (title) return title;
  }
  return "Untitled";
}

/** Project display name for a note saved from a session, or null without a project. */
export function noteSourceProject(cwd?: string): string | null {
  if (!cwd || !looksLikeProject(cwd)) return null;
  const name = projectDisplayName(cwd);
  return name || null;
}

export function notePreview(text: string, title: string): string {
  const parts: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s{0,3}#{1,6}\s+/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const next = unwrapMarkdown(trimmed.replace(/^[-*+]\s+/, ""));
    if (!next || next === title) continue;
    parts.push(next);
    if (parts.join(" ").length >= 120) break;
  }
  const preview = parts.join(" ");
  if (!preview) return "";
  return preview.length > 120 ? `${preview.slice(0, 119)}…` : preview;
}

export function appendNoteReference(draft: string, title: string, body: string): string {
  const content = body.replace(/\r\n?/g, "\n").trim();
  if (!content) return draft;
  const heading = title.trim() || "Untitled";
  const block = `Note: ${heading}\n\n${content}`;
  const separator =
    draft.length === 0 ? "" : draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  return `${draft}${separator}${block}\n\n`;
}

export function noteSlugsInText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  NOTE_SLUG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NOTE_SLUG_RE.exec(text))) {
    const slug = match[2];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    found.push(slug);
  }
  return found;
}

export function injectNotePrompt(text: string, notes: Note[]): string {
  if (notes.length === 0) return text;
  const blocks = notes.map((note) => {
    const heading = note.title.trim() || "Untitled";
    return [`Referenced note "${heading}":`, "", note.body.trim()].join("\n");
  });
  return [text.trimEnd(), "", "---", ...blocks].join("\n");
}

export async function applyNotesToTurn(text: string): Promise<string> {
  const slugs = noteSlugsInText(text);
  if (slugs.length === 0) return text;
  const notes = await loadNoteSummaries();
  const picked: NoteSummary[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    const note = notes.find((item) => item.slug === slug);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    picked.push(note);
  }
  if (picked.length === 0) return text;
  const details = await Promise.all(picked.map((note) => getNote(note.id)));
  return injectNotePrompt(
    text,
    details.filter((note): note is Note => note !== null),
  );
}

export function noteComposerCard(note: Note): NoteComposerCard {
  return {
    id: note.id,
    slug: note.slug,
    title: note.title,
    body: note.body,
    ...(note.sourceCwd ? { sourceCwd: note.sourceCwd } : {}),
  };
}

export function requestAddNoteToChat(note: Note) {
  if (typeof window === "undefined") return;
  if (!note.body.replace(/\r\n?/g, "\n").trim()) return;
  window.dispatchEvent(
    new CustomEvent<NoteComposerCard>(ADD_NOTE_TO_CHAT_EVENT, {
      detail: noteComposerCard(note),
    }),
  );
}

export function composeNoteMessage(card: NoteComposerCard | undefined, text: string): string {
  if (!card) return text.trim();
  const lead = text.trim() || "Use this note.";
  return injectNotePrompt(lead, [
    {
      id: card.id,
      slug: card.slug,
      title: card.title,
      body: card.body,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
}

function unwrapMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .trim();
}
