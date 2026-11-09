import { composerDraftOf } from "../../sessions/model/draftCache";
import type { Attachment } from "../../sessions/model/session";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";
import { extractVoiceDocument, voiceDocumentKind } from "./voiceDocumentContext";

/** A voice read never flushes, clears, submits, focuses or commits the composer. */
export type VoiceDraftInput = {
  text: string;
  attachments: readonly Attachment[];
  composing?: boolean;
  attachmentsPending?: boolean;
};

export const VOICE_DRAFT_MAX_TEXT = 32_000;
export const VOICE_DRAFT_MAX_ATTACHMENTS = 20;
export const VOICE_DRAFT_MAX_FILE_BYTES = 8 * 1024 * 1024;

const readers = new Map<string, () => VoiceDraftInput>();

/** The mounted reader observes the actual textarea, including uncommitted IME. */
export function registerVoiceDraftReader(
  sessionId: string,
  read: () => VoiceDraftInput,
): () => void {
  readers.set(sessionId, read);
  return () => {
    // A retired pane cannot unregister its replacement's reader.
    if (readers.get(sessionId) === read) readers.delete(sessionId);
  };
}

function capture(sessionId: string) {
  const reader = readers.get(sessionId);
  const draft = reader ? reader() : composerDraftOf(sessionId);
  return {
    source: reader ? ("mounted" as const) : ("cache" as const),
    text: draft.text,
    attachments: draft.attachments.map((file) => ({ ...file })),
    composing: "composing" in draft && draft.composing === true,
    attachmentsPending: "attachmentsPending" in draft && draft.attachmentsPending === true,
  };
}

function textAttachment(file: Attachment): boolean {
  return (
    /^text\//i.test(file.mimeType) ||
    /^application\/(?:json|[^;]+\+json|xml|[^;]+\+xml|javascript|sql|graphql)(?:;|$)/i.test(
      file.mimeType,
    ) ||
    /\.(?:txt|md|mdx|csv|tsv|log|json|jsonl|ya?ml|toml|xml|html?|css|scss|[cm]?jsx?|tsx?|rs|py|go|java|kt|swift|[ch]|cpp|hpp|cs|rb|php|sh|sql|graphql)$/i.test(
      file.name,
    )
  );
}

function imageAttachment(file: Attachment): boolean {
  return file.kind === "image" && /^image\/(?:png|jpe?g|webp|gif)$/i.test(file.mimeType);
}

function unavailable(file: Attachment): string | undefined {
  if (file.missing) return "missing";
  if (!Number.isSafeInteger(file.size) || file.size < 0) return "invalid_size";
  if (file.size > VOICE_DRAFT_MAX_FILE_BYTES) return "too_large";
  if (file.data === undefined && !file.path && !file.loadPreview) return "no_content";
  if (
    !imageAttachment(file) &&
    !textAttachment(file) &&
    !voiceDocumentKind(file.name, file.mimeType)
  )
    return "unsupported_format";
  return undefined;
}

/** Metadata only: file names are never presented as inspected image/file contents. */
export function readVoiceDraftContext(sessionId: string) {
  const draft = capture(sessionId);
  return Object.freeze({
    sessionId,
    source: draft.source,
    unsent: true as const,
    text: draft.text.slice(0, VOICE_DRAFT_MAX_TEXT),
    textLength: draft.text.length,
    textTruncated: draft.text.length > VOICE_DRAFT_MAX_TEXT,
    composing: draft.composing,
    attachmentsPending: draft.attachmentsPending,
    attachmentCount: draft.attachments.length,
    attachmentsTruncated: draft.attachments.length > VOICE_DRAFT_MAX_ATTACHMENTS,
    attachments: Object.freeze(
      draft.attachments.slice(0, VOICE_DRAFT_MAX_ATTACHMENTS).map((file) => {
        const reason = unavailable(file);
        return Object.freeze({
          id: file.id,
          name: file.name.slice(0, 512),
          mimeType: file.mimeType.slice(0, 128),
          kind: file.kind,
          size: file.size,
          content: reason ? ("unavailable" as const) : ("not_read" as const),
          ...(reason ? { reason } : {}),
          readableAs: reason
            ? null
            : imageAttachment(file)
              ? ("image" as const)
              : ("text" as const),
        });
      }),
    ),
  });
}

export type VoiceDraftAttachmentResult =
  | { sessionId: string; attachmentId: string; kind: "unavailable"; reason: string }
  | {
      sessionId: string;
      attachmentId: string;
      name: string;
      kind: "image";
      mimeType: string;
      dataUrl: string;
    }
  | {
      sessionId: string;
      attachmentId: string;
      name: string;
      kind: "text";
      text: string;
      textLength: number;
      truncated: boolean;
      format?: "pdf" | "docx" | "spreadsheet";
      coverage?: "text-only";
    };

function sameSource(a: Attachment, b: Attachment) {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.mimeType === b.mimeType &&
    a.size === b.size &&
    a.path === b.path &&
    a.hostEnvironmentId === b.hostEnvironmentId &&
    a.data === b.data &&
    a.loadPreview === b.loadPreview &&
    !b.missing
  );
}

function base64Bytes(data: string): Uint8Array {
  if (
    data.length > Math.ceil(VOICE_DRAFT_MAX_FILE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  )
    throw new Error("Invalid attachment data.");
  return Uint8Array.from(atob(data), (value) => value.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/**
 * Read an ID already in this session's unsent draft, never a model-supplied path.
 * The caller must first authorize the target session. Inline images become real
 * provider image input; a tool's JSON result alone does not give a model vision.
 */
export async function readVoiceDraftAttachment(
  sessionId: string,
  attachmentId: string,
): Promise<VoiceDraftAttachmentResult> {
  const failed = (reason: string): VoiceDraftAttachmentResult => ({
    sessionId,
    attachmentId,
    kind: "unavailable",
    reason,
  });
  const file = capture(sessionId).attachments.find((entry) => entry.id === attachmentId);
  if (!file) return failed("not_in_draft");
  const reason = unavailable(file);
  if (reason) return failed(reason);
  try {
    const data = file.loadPreview ? await file.loadPreview() : file.data;
    let bytes: Uint8Array;
    if (data !== undefined) bytes = base64Bytes(data);
    else if (file.path) {
      const path =
        file.hostEnvironmentId && !parseRemotePath(file.path)
          ? remotePath(file.hostEnvironmentId, file.path)
          : file.path;
      const { readBinaryFile } = await import("../../../platform/tauri/fs");
      bytes = await readBinaryFile(path);
    } else return failed("no_content");
    const current = capture(sessionId).attachments.find((entry) => entry.id === attachmentId);
    if (!current || !sameSource(file, current)) return failed("draft_changed");
    if (bytes.byteLength > VOICE_DRAFT_MAX_FILE_BYTES) return failed("too_large");
    if (imageAttachment(file))
      return {
        sessionId,
        attachmentId,
        name: file.name,
        kind: "image",
        mimeType: file.mimeType.replace(/^image\/jpg$/i, "image/jpeg"),
        dataUrl: `data:${file.mimeType.replace(/^image\/jpg$/i, "image/jpeg")};base64,${toBase64(bytes)}`,
      };
    const format = voiceDocumentKind(file.name, file.mimeType);
    if (format) {
      const document = await extractVoiceDocument(bytes, format);
      const latest = capture(sessionId).attachments.find((entry) => entry.id === attachmentId);
      if (!latest || !sameSource(file, latest)) return failed("draft_changed");
      return { sessionId, attachmentId, name: file.name, kind: "text", ...document };
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      sessionId,
      attachmentId,
      name: file.name,
      kind: "text",
      text: text.slice(0, VOICE_DRAFT_MAX_TEXT),
      textLength: text.length,
      truncated: text.length > VOICE_DRAFT_MAX_TEXT,
    };
  } catch {
    // File/Host errors can include private paths or credentials.
    return failed("read_failed");
  }
}
