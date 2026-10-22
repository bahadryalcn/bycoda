import type { NoteCardMeta, NoteComposerCard } from "./notes";

/** Shared desktop/host context shape; display metadata never stores the body. */
export function readNoteContext(value: unknown): NoteComposerCard {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid note context");
  const row = value as Record<string, unknown>;
  const bounded = (text: unknown, max: number) => typeof text === "string" && text.length <= max && !text.includes("\0");
  if (Object.keys(row).some((key) => !["id", "slug", "title", "body", "sourceCwd"].includes(key)) ||
    typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(row.id) ||
    !bounded(row.slug, 256) || !bounded(row.title, 400) || Array.from(row.title as string).length > 200 || !bounded(row.body, 64_000) || !(row.body as string).trim() ||
    row.sourceCwd !== undefined && !bounded(row.sourceCwd, 4096)) throw new Error("Invalid or oversized note context");
  return { id: row.id, slug: row.slug as string, title: row.title as string, body: row.body as string,
    ...(row.sourceCwd === undefined ? {} : { sourceCwd: row.sourceCwd as string }) };
}

export function noteContextMeta(card: NoteComposerCard): NoteCardMeta {
  return { id: card.id, slug: card.slug, title: card.title, ...(card.sourceCwd ? { sourceCwd: card.sourceCwd } : {}) };
}

export function composeNoteContext(card: NoteComposerCard | undefined, text: string): string {
  if (!card) return text.trim();
  return [text.trim() || "Use this note.", "", "---", `Referenced note "${card.title.trim() || "Untitled"}":`, "", card.body.trim()].join("\n");
}
