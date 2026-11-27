import { errorText } from "../../../shared/lib/errors";
import type { AttachmentReadCapacity } from "./attachmentReadCapacity";
import { FOLDER_MIME, normalizeImageMime, isVisionImage } from "./attachmentPrompt";
export {
  ATTACHMENT_ONLY_PROMPT,
  attachmentPath,
  attachmentPathText,
  isAttachmentFolder,
  isVisionImage,
  normalizeImageMime,
  promptBlocks,
  promptText,
  type PromptContentBlock,
} from "./attachmentPrompt";
import { invoke } from "@tauri-apps/api/core";
import { basename, pickFiles as pickFilePaths } from "../../../platform/tauri/fs";
import type { Attachment, AttachmentKind } from "./session";
import { AttachmentFailureError, selectionExceedsCapacity } from "./attachmentFailure";

export const MAX_ATTACHMENTS = 20;
export const MAX_EMBED_BYTES = 20 * 1024 * 1024;
/**
 * Inline image bytes one draft, one selection or one send may hold across all
 * files. Past it a file with a saved path stays attached as that path (the
 * harness reads it from disk) instead of carrying base64 in memory.
 */
export const MAX_TOTAL_EMBED_BYTES = 48 * 1024 * 1024;
/** Reads of `read_file_base64` in flight at once while preparing a send. */
const PREPARE_READ_CONCURRENCY = 3;

/** Decoded bytes a file currently holds inline. */
function inlineBytes(file: Attachment): number {
  return file.data ? file.size : 0;
}

function withoutInlineData(file: Attachment): Attachment {
  const { data: _data, ...rest } = file;
  return rest;
}

/**
 * A pasted or dropped blob that was left out: bytes with no disk path can only
 * travel inline, so one over the embed limit, or one the webview cannot read,
 * is reported by name while its valid siblings are still attached.
 */
export type SkippedAttachment = { name: string; reason: "too-large" | "unreadable" };

type PathInfo = {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
};

type NativeFile = File & { path?: string };

const SKIP_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "application/toml",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/javascript",
  jsx: "text/plain",
  mjs: "text/javascript",
  cjs: "text/javascript",
  css: "text/css",
  rs: "text/plain",
  py: "text/x-python",
  go: "text/plain",
  java: "text/plain",
  kt: "text/plain",
  swift: "text/plain",
  c: "text/plain",
  h: "text/plain",
  cc: "text/plain",
  cpp: "text/plain",
  hpp: "text/plain",
  cs: "text/plain",
  rb: "text/plain",
  php: "text/plain",
  sh: "text/plain",
  zsh: "text/plain",
  bash: "text/plain",
  sql: "application/sql",
  graphql: "application/graphql",
};

export function persistableAttachment(file: Attachment): Attachment {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    kind: file.kind,
    size: file.size,
    ...(file.path ? { path: file.path } : {}),
    ...(file.hostEnvironmentId ? { hostEnvironmentId: file.hostEnvironmentId } : {}),
    ...(file.browserAnnotation ? { browserAnnotation: file.browserAnnotation } : {}),
  };
}

export function displayAttachments(files: Attachment[]): Attachment[] {
  return files.map((file) => ({
    ...persistableAttachment(file),
    ...(file.path ? { copyFromPath: true } : {}),
    ...(file.previewUrl ? { previewUrl: file.previewUrl } : {}),
    ...(file.data ? { data: file.data } : {}),
    ...(file.loadPreview ? { loadPreview: file.loadPreview } : {}),
  }));
}

// Composer renders run per keystroke; rebuilding a multi-MB data URL each time is wasteful.
const previewSrcCache = new WeakMap<Attachment, { data: string; mimeType: string; src: string }>();

export function attachmentPreviewSrc(file: Attachment): string | undefined {
  if (file.data && file.kind === "image") {
    const cached = previewSrcCache.get(file);
    if (cached && cached.data === file.data && cached.mimeType === file.mimeType) return cached.src;
    const src = `data:${file.mimeType};base64,${file.data}`;
    previewSrcCache.set(file, { data: file.data, mimeType: file.mimeType, src });
    return src;
  }
  return file.previewUrl;
}

export function revokeAttachment(file: Attachment) {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

export function mergeAttachments(existing: Attachment[], incoming: Attachment[]): Attachment[] {
  const next = [...existing];
  let embedded = existing.reduce((sum, file) => sum + inlineBytes(file), 0);
  for (const file of incoming) {
    if (next.length >= MAX_ATTACHMENTS) break;
    const duplicate = next.some(
      (item) =>
        (item.path &&
          file.path &&
          item.path === file.path &&
          item.hostEnvironmentId === file.hostEnvironmentId) ||
        item.id === file.id,
    );
    if (duplicate) continue;
    // shortcut: a file with bytes and no path cannot fall back to a path, so it stays inline
    // (still under the per-file limit); composer producers always save a path, upgrade if not.
    if (
      inlineBytes(file) > 0 &&
      embedded + inlineBytes(file) > MAX_TOTAL_EMBED_BYTES &&
      file.path
    ) {
      next.push(withoutInlineData(file));
      continue;
    }
    embedded += inlineBytes(file);
    next.push(file);
  }
  return next;
}

type ClipboardFileItem = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

/** Clipboard files plus items. WebKit's FileList is often truncated to the first file. */
export function filesFromClipboard(
  data:
    | {
        files?: ArrayLike<File> | null;
        items?: ArrayLike<ClipboardFileItem> | null;
      }
    | null
    | undefined,
): File[] {
  const fromList = arrayLike(data?.files);
  const fromItems: File[] = [];
  for (const item of arrayLike(data?.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  const files = fromItems.length > fromList.length ? fromItems : fromList;
  return dropMacScreenshotTwins(files);
}

function arrayLike<T>(list: ArrayLike<T> | null | undefined): T[] {
  return list ? Array.from(list) : [];
}

/** macOS often exposes the same screenshot as PNG and an unnamed TIFF. */
function dropMacScreenshotTwins(files: File[]): File[] {
  const unnamedTiff = (file: File) => {
    const type = file.type.toLowerCase();
    if (type !== "image/tiff" && type !== "image/tif") return false;
    const name = file.name.trim().toLowerCase();
    return !name || name === "image.tiff" || name === "image.tif" || name === "image";
  };
  const hasOtherImage = files.some((file) => file.type.startsWith("image/") && !unnamedTiff(file));
  if (!hasOtherImage) return files;
  return files.filter((file) => !unnamedTiff(file));
}

/** Own one chooser's successful selection across downstream inspection retries.
 * Constructing this token has no native effect; read starts inside admission.
 * It is a local locator, never a filesystem access or persistence receipt.
 */
export function retainAttachmentPickerSelection() {
  let selected: readonly string[] | undefined;
  let pending: Promise<readonly string[]> | undefined;
  let failure: Error | undefined;
  return Object.freeze({
    read(): Promise<readonly string[]> {
      if (failure) return Promise.reject(failure);
      if (selected) return Promise.resolve(selected);
      if (pending) return pending;
      const actual = pickFilePaths().then((paths) => {
        const selection = paths ?? [];
        if (selectionExceedsCapacity(selection)) {
          failure = new AttachmentFailureError(
            "selection-too-large",
            "The selected file paths exceed retained attachment capacity.",
          );
          throw failure;
        }
        selected = Object.freeze([...selection]);
        return selected;
      });
      pending = actual;
      void actual.then(
        () => {
          pending = undefined;
        },
        () => {
          pending = undefined;
        },
      );
      return actual;
    },
  });
}

export async function pickAttachments(
  selection?: ReturnType<typeof retainAttachmentPickerSelection>,
  capacity?: AttachmentReadCapacity,
): Promise<Attachment[]> {
  const paths = selection ? await selection.read() : await pickFilePaths();
  if (!paths?.length) return [];
  return attachmentsFromPaths([...paths], capacity);
}

export async function attachmentsFromPaths(
  paths: string[],
  capacity?: AttachmentReadCapacity,
): Promise<Attachment[]> {
  const unique = [...new Set(paths.filter((path) => path.trim()))];
  if (unique.length === 0) return [];
  const infos = await invoke<PathInfo[]>("inspect_paths", { paths: unique });
  const out: Attachment[] = [];
  let embedded = 0;
  for (const info of infos) {
    // Sequential, and each read sees what the selection already holds, so a folder of large
    // screenshots never reads more than the total budget before the draft merge.
    if (skipName(info.name)) continue;
    const slot = capacity?.reserve(info.path);
    if (slot === null) continue;
    const embed = !capacity || slot !== undefined;
    const file = await attachmentFromPath(info, embed ? MAX_TOTAL_EMBED_BYTES - embedded : 0);
    embedded += inlineBytes(file);
    out.push(file);
  }
  return out;
}

export async function attachmentsFromFiles(
  files: File[],
  options?: {
    persistBlobs?: boolean;
    capacity?: AttachmentReadCapacity;
    /** Called once with the blobs left out; path files are never embedded, so never skipped. */
    onSkipped?: (skipped: SkippedAttachment[]) => void;
  },
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  const skipped: SkippedAttachment[] = [];
  const pathFiles: string[] = [];
  const blobs: File[] = [];
  for (const file of files) {
    const path = nativePath(file);
    if (path) pathFiles.push(path);
    else blobs.push(file);
  }
  if (pathFiles.length) {
    out.push(...(await attachmentsFromPaths(pathFiles, options?.capacity)));
  }
  let embedded = out.reduce((sum, file) => sum + inlineBytes(file), 0);
  for (const file of blobs) {
    if (skipName(file.name) || file.size < 0) continue;
    // Checked before any preview URL or read, so an oversized blob costs nothing.
    if (file.size > MAX_EMBED_BYTES) {
      skipped.push({ name: blobName(file), reason: "too-large" });
      continue;
    }
    // A saved blob past the total budget keeps its path and drops its bytes; one that
    // cannot be saved (`persistBlobs: false`) has only its bytes, so it stays inline.
    const slot = options?.capacity?.reserve();
    if (slot === null) continue;
    const embed = options?.persistBlobs === false || embedded + file.size <= MAX_TOTAL_EMBED_BYTES;
    const item = await attachmentFromBlob(file, options?.persistBlobs !== false, embed);
    if (item === "unreadable") {
      if (slot !== undefined) options?.capacity?.release(slot);
      skipped.push({ name: blobName(file), reason: "unreadable" });
    } else {
      embedded += inlineBytes(item);
      out.push(item);
    }
  }
  if (skipped.length) options?.onSkipped?.(skipped);
  return out;
}

export async function prepareAttachments(files: Attachment[]): Promise<Attachment[]> {
  const prepared = [...files];
  // Budget is reserved in attachment order before any read starts, so the first files win and
  // concurrent reads cannot overshoot; the rest stay path references.
  let embedded = files.reduce((sum, file) => sum + inlineBytes(file), 0);
  const wanted: number[] = [];
  files.forEach((file, index) => {
    if (file.data || !file.path) return;
    if (!isVisionImage(file.mimeType) || file.size > MAX_EMBED_BYTES) return;
    if (embedded + file.size > MAX_TOTAL_EMBED_BYTES) return;
    embedded += file.size;
    wanted.push(index);
  });
  let cursor = 0;
  const worker = async () => {
    for (let slot = cursor++; slot < wanted.length; slot = cursor++) {
      const index = wanted[slot];
      try {
        const data = await invoke<string>("read_file_base64", { path: files[index].path });
        prepared[index] = { ...files[index], data };
      } catch {
        // Keep the path so the agent can still read the file.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PREPARE_READ_CONCURRENCY, wanted.length) }, worker),
  );
  return prepared;
}

async function attachmentFromPath(
  info: PathInfo,
  embedRoom = MAX_TOTAL_EMBED_BYTES,
): Promise<Attachment> {
  // A folder's name says nothing about its contents, and a harness handed a
  // resource_link for a directory has nothing to open.
  const mimeType = info.isDir ? FOLDER_MIME : mimeFromName(info.name);
  const kind = kindFromMime(mimeType);
  const file: Attachment = {
    id: crypto.randomUUID(),
    name: info.name,
    mimeType,
    kind,
    size: info.size,
    path: info.path,
  };
  if (
    isVisionImage(mimeType) &&
    info.size > 0 &&
    info.size <= MAX_EMBED_BYTES &&
    info.size <= embedRoom
  ) {
    try {
      file.data = await invoke<string>("read_file_base64", { path: info.path });
    } catch {
      // Fall back to a resource_link so the agent can still read the file.
    }
  }
  return file;
}

function blobName(file: File): string {
  return file.name.trim() || fallbackName(mimeFromFile(file));
}

async function attachmentFromBlob(
  file: File,
  persist = true,
  embed = true,
): Promise<Attachment | "unreadable"> {
  const mimeType = mimeFromFile(file);
  const kind = kindFromMime(mimeType);
  const name = blobName(file);
  const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
  const data = await readBlobBase64(file);
  if (data === null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    return "unreadable";
  }
  // Notes owns each temporary write and its partial-success cleanup. Other
  // attachment callers keep the durable saved-path default.
  if (!persist)
    return { id: crypto.randomUUID(), name, mimeType, kind, size: file.size, data, previewUrl };
  try {
    const path = await invoke<string>("write_attachment", { name, data });
    if (!path?.trim()) throw new Error("Attachment storage returned no file path");
    const visionImage = kind === "image" && isVisionImage(mimeType);
    return {
      id: crypto.randomUUID(),
      name,
      mimeType: visionImage ? normalizeImageMime(mimeType) : mimeType,
      kind,
      size: file.size,
      path,
      // Inline bytes feed vision providers; the saved path survives transcript
      // sanitization and reopening after the process and blob URL are gone.
      ...(visionImage && embed ? { data } : {}),
      previewUrl,
    };
  } catch (error) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const reason = errorText(error);
    throw new Error(`Could not attach ${name}: ${reason}. Paste or attach the file again.`);
  }
}

function mimeFromFile(file: File): string {
  const fromName = mimeFromName(file.name);
  if (file.type && file.type !== "application/octet-stream") {
    if (fromName !== "application/octet-stream") return fromName;
    return file.type;
  }
  return fromName;
}

function mimeFromName(name: string): string {
  const ext = extension(name);
  if (!ext) return "application/octet-stream";
  return MIME_BY_EXT[ext] ?? (isTextExt(ext) ? "text/plain" : "application/octet-stream");
}

function isTextExt(ext: string): boolean {
  return [
    "txt",
    "md",
    "rst",
    "log",
    "cfg",
    "ini",
    "env",
    "lock",
    "gradle",
    "cmake",
    "mk",
    "vue",
    "svelte",
    "astro",
    "scss",
    "sass",
    "less",
    "lua",
    "r",
    "jl",
    "ex",
    "exs",
    "erl",
    "hs",
    "ml",
    "clj",
    "scala",
    "groovy",
    "dart",
    "nim",
    "zig",
    "proto",
    "graphqls",
  ].includes(ext);
}

function kindFromMime(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function extension(name: string): string {
  const base = basename(name).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1);
}

function skipName(name: string): boolean {
  return SKIP_NAMES.has(basename(name).toLowerCase());
}

function nativePath(file: File): string | undefined {
  const path = (file as NativeFile).path;
  return path?.trim() ? path : undefined;
}

function fallbackName(mimeType: string): string {
  if (mimeType === "image/png") return "image.png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image.jpg";
  if (mimeType === "image/gif") return "image.gif";
  if (mimeType === "image/webp") return "image.webp";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "attachment";
}

function readBlobBase64(file: File): Promise<string | null> {
  if (file.size > MAX_EMBED_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        resolve(null);
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
