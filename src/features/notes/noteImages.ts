import { invoke } from "@tauri-apps/api/core";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  revokeAttachment,
} from "../sessions/model/attachments";
import type { Attachment } from "../sessions/model/session";
import {
  noteTitleError,
  resolveNoteImagePath,
  peekNoteImagePath,
  forgetNoteImagePaths,
  upsertNote,
  type Note,
  type NoteUpsert,
} from "./notes";
import { requireNoteWork, type NoteInputWork } from "./notesInputOwners";
import { beginNoteServiceIntent } from "./noteServiceIntents";

export const NOTE_IMAGE_PREFIX = "/note-assets/";

export type NoteImageAsset = {
  name: string;
  markdownPath: string;
};

/** The asset write succeeded; only its following display application failed. */
export class NoteImageApplicationError extends Error {
  constructor(
    readonly asset: Readonly<NoteImageAsset>,
    cause: unknown,
  ) {
    super(
      `Image saved; display preparation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "NoteImageApplicationError";
  }
}
const imageApplicationOutcomes = new WeakMap<object, readonly NoteImageApplicationError[]>();
export function noteImageApplicationErrors(outcome: unknown): readonly NoteImageApplicationError[] {
  return outcome && typeof outcome === "object"
    ? (imageApplicationOutcomes.get(outcome) ?? [])
    : [];
}

export type MarkdownInsertion = {
  value: string;
  cursor: number;
};

/** Keep the original save intent owned through its actual grant/cache outcome. */
async function saveResolvedImage(
  noteId: string,
  sourcePath: string,
  parent: NoteInputWork,
): Promise<NoteImageAsset> {
  const work = requireNoteWork("note-image-save-and-resolve", parent);
  let applied = false;
  let applicationError: unknown;
  try {
    const args = { noteId, sourcePath };
    const saved = await beginNoteServiceIntent("notes_save_image", args, work).execute(
      () => invoke<NoteImageAsset>("notes_save_image", args),
      async (image) => {
        try {
          const path = await resolveNoteImagePath(image.markdownPath, work);
          if (peekNoteImagePath(image.markdownPath) !== path)
            throw new Error("Image path resolution was not observed.");
          work.apply(() => {
            applied = true;
          });
        } catch (error) {
          applicationError = error;
          throw error;
        }
      },
    );
    // Native save success stays success in the intent observer. This composite
    // pipeline publishes no Markdown until its separate path application exists.
    if (!applied)
      throw new NoteImageApplicationError(
        Object.freeze({ ...saved }),
        applicationError ?? new Error("Image path resolution was not observed."),
      );
    return saved;
  } finally {
    work();
  }
}

/** Recovery copies own their note assets so either note can later be deleted. */
export async function createRecoveredNote(
  input: Omit<NoteUpsert, "id" | "expectedUpdatedAt">,
  parent?: NoteInputWork,
): Promise<Note> {
  const titleError = noteTitleError(input.title);
  if (titleError) throw new Error(titleError);
  const work = requireNoteWork("recovered-note", parent);
  const id = crypto.randomUUID();
  const assetPattern = /(?<![\w:/])\/note-assets\/[A-Za-z0-9_-]{1,200}\/[A-Za-z0-9_.-]+/g;
  const assets = new Set(input.body.match(assetPattern) ?? []);
  const replacements = new Map<string, string>();
  let copyingStarted = false;
  try {
    for (const asset of assets) {
      const sourcePath = await resolveNoteImagePath(asset, work);
      copyingStarted = true;
      const saved = await saveResolvedImage(id, sourcePath, work);
      work.apply(() => replacements.set(asset, saved.markdownPath));
    }
    // Never create the replacement until every referenced note image is copied.
    const body = input.body.replace(assetPattern, (asset) => replacements.get(asset)!);
    return await upsertNote({ ...input, id, body, expectedUpdatedAt: 0 }, work);
  } catch (error) {
    if (copyingStarted) {
      try {
        // Native code checks that no note row exists: an ambiguous successful
        // upsert must retain its copied assets even if its response was lost.
        const args = { id };
        await beginNoteServiceIntent("notes_discard_recovery_assets", args, work).execute(
          () => invoke<void>("notes_discard_recovery_assets", args),
          () => {
            forgetNoteImagePaths(id);
          },
        );
      } catch (cleanupError) {
        throw new Error(
          `${String(error)}\n\nCould not remove unused recovery images: ${String(cleanupError)}`,
        );
      }
    }
    throw error;
  } finally {
    work();
  }
}

export async function saveNoteImagesFromFiles(
  noteId: string,
  files: File[],
  parent?: NoteInputWork,
): Promise<NoteImageAsset[]> {
  const work = requireNoteWork("note-image-files", parent);
  try {
    return await saveNoteImageAttachments(noteId, await attachmentsFromFiles(files, { persistBlobs: false }), work);
  } finally {
    work();
  }
}

export async function saveNoteImagesFromPaths(
  noteId: string,
  paths: string[],
  parent?: NoteInputWork,
): Promise<NoteImageAsset[]> {
  const work = requireNoteWork("note-image-paths", parent);
  try {
    return await saveNoteImageAttachments(noteId, await attachmentsFromPaths(paths), work);
  } finally {
    work();
  }
}

async function saveNoteImageAttachments(
  noteId: string,
  attachments: Attachment[],
  work: NoteInputWork,
): Promise<NoteImageAsset[]> {
  const images = attachments.filter((file) => file.kind === "image");
  if (images.length === 0) {
    throw new Error("Drop a PNG, JPG, GIF, WebP, or SVG image.");
  }

  const saved: NoteImageAsset[] = [];
  const applicationErrors: NoteImageApplicationError[] = [];
  let failure: unknown;
  try {
    for (const image of images) {
      let sourcePath = image.path;
      let temporary = false;
      try {
        if (!sourcePath && image.data) {
          sourcePath = await invoke<string>("write_attachment", {
            name: image.name,
            data: image.data,
          });
          temporary = true;
        }
        if (!sourcePath) continue;
        const result = await saveResolvedImage(noteId, sourcePath, work);
        work.apply(() => saved.push(result));
      } catch (err: unknown) {
        failure ??= err;
        if (err instanceof NoteImageApplicationError) applicationErrors.push(err);
      } finally {
        if (temporary) {
          await invoke("delete_path", { path: sourcePath }).catch(() => undefined);
        }
      }
    }
  } finally {
    for (const image of images) revokeAttachment(image);
  }

  if (saved.length === 0) {
    if (failure instanceof Error) {
      if (applicationErrors.length)
        imageApplicationOutcomes.set(failure, Object.freeze(applicationErrors));
      throw failure;
    }
    if (failure) throw new Error(String(failure));
    throw new Error("None of the dropped images could be added to the note.");
  }
  if (applicationErrors.length)
    imageApplicationOutcomes.set(saved, Object.freeze(applicationErrors));
  return saved;
}

export function noteImageMarkdown(image: NoteImageAsset): string {
  const alt = image.name
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]])/g, "\\$1");
  return `![${alt}](${image.markdownPath})`;
}

export function insertNoteImagesMarkdown(
  value: string,
  start: number,
  end: number,
  images: NoteImageAsset[],
): MarkdownInsertion {
  if (images.length === 0) {
    const cursor = Math.max(0, Math.min(start, value.length));
    return { value, cursor };
  }

  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const before = value.slice(0, from);
  const after = value.slice(to);
  const block = images.map(noteImageMarkdown).join("\n\n");
  const leading = before
    ? before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n"
    : "";
  const trailing = after
    ? after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n"
    : "";
  const inserted = `${leading}${block}`;

  return {
    value: `${before}${inserted}${trailing}${after}`,
    cursor: before.length + inserted.length,
  };
}

export function isNoteImagePath(value: string): boolean {
  return value.startsWith(NOTE_IMAGE_PREFIX);
}
