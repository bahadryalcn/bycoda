import { errorText } from "../../shared/lib/errors";
import { t } from "../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";
import {
  attachmentDraftTokens,
  attachmentsFromFiles,
  attachmentsFromPaths,
  findTokens,
  isAttachmentFolder,
  MAX_ATTACHMENTS,
  MAX_EMBED_BYTES,
  rewriteTokenMatches,
  stripAttachmentTokens,
  type Attachment,
  type AttachmentReadCapacity,
} from "../../features/sessions/public/attachments";
import { decodeBase64 } from "../../shared/lib/base64";
import { REMOTE_PATH_PREFIX } from "../../shared/lib/remotePaths";
import { withTimeout } from "../../shared/lib/withTimeout";

type CopiedFile = { name: string; mimeType: string; data: string };

/** Marks one embedded file; its value is the escaped file name. */
const FILE_ATTRIBUTE = 'data-bycoda-file="';
const REFERENCE_ATTRIBUTE = 'data-bycoda-reference-text="';
const LEGACY_FILES_ATTRIBUTE = 'data-bycoda-files="';
const DATA_URI_PREFIX = "data:";
const BASE64_MARKER = ";base64,";
/** Room for the message text, markup and file names around the base64 payload. */
const MAX_CLIPBOARD_METADATA_CHARS = 4 * 1024 * 1024;
const MAX_CLIPBOARD_BASE64_CHARS = Math.ceil(MAX_EMBED_BYTES / 3) * 4;
const MAX_CLIPBOARD_HTML_CHARS = MAX_CLIPBOARD_BASE64_CHARS + MAX_CLIPBOARD_METADATA_CHARS;
// Older builds URI-encoded the attachment JSON and duplicated the bytes as data URIs.
const MAX_LEGACY_METADATA_CHARS = 64 * 1024;
const MAX_LEGACY_PAYLOAD_CHARS = MAX_CLIPBOARD_BASE64_CHARS * 3 + MAX_LEGACY_METADATA_CHARS;
const MAX_LEGACY_HTML_CHARS =
  MAX_LEGACY_PAYLOAD_CHARS + MAX_CLIPBOARD_BASE64_CHARS + MAX_LEGACY_METADATA_CHARS;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const HTML_UNESCAPES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

function unescapeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_UNESCAPES[entity]!);
}

function embeddedByteLength(data: string): number {
  if (
    data.length > MAX_CLIPBOARD_BASE64_CHARS ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new Error("Invalid or oversized attachment content.");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length * 3) / 4 - padding;
}

/** Folder paths the plain text does not already list, one per line. */
function textWithFolderPaths(text: string, paths: string[]): string {
  const lines = new Set(text.split("\n"));
  const extra = paths.filter((path) => !lines.has(path));
  if (!extra.length) return text;
  const suffix = extra.join("\n");
  if (!text) return suffix;
  return text.endsWith("\n") ? text + suffix : `${text}\n${suffix}`;
}

/** HTML keeps arbitrary files together with text across Bycoda windows. */
export async function copyMessage(text: string, attachments: Attachment[] = []): Promise<void> {
  const matches = findTokens(text, attachments);
  const referenced = new Set(matches.map(({ index }) => index));
  const fileAttachments: Attachment[] = [];
  // Folders travel as path text. Only append paths with no inline reference.
  const folderPaths = attachments.map((attachment) =>
    isAttachmentFolder(attachment) ? (attachment.path?.trim() ?? "") : undefined,
  );
  const loosePaths = folderPaths.filter(
    (path, index): path is string => Boolean(path) && !referenced.has(index),
  );
  const fileSlots = attachments.map((attachment, index) =>
    folderPaths[index] === undefined ? fileAttachments.push(attachment) - 1 : -1,
  );
  const payload = textWithFolderPaths(
    rewriteTokenMatches(text, matches, ({ index }) => folderPaths[index] ?? ""),
    loosePaths,
  );
  if (!fileAttachments.length) {
    if (!payload) throw new Error("No copyable content is available.");
    return copyText(payload);
  }
  const referenceText = rewriteTokenMatches(text, matches, ({ index }) => {
    const slot = fileSlots[index];
    return slot < 0
      ? (folderPaths[index] ?? "")
      : `[${attachments[index].kind === "image" ? "Image" : "File"}: Attachment; ref=clipboard-${slot}]`;
  });

  // Start the clipboard write during the click. WebKit can lose the gesture
  // while a remote attachment is loading. Every format waits for validation.
  const content = Promise.resolve().then(async () => {
    const files = await loadCopiedFiles(fileAttachments);
    return {
      files,
      html: messageClipboardHtml(
        payload,
        files,
        matches.length ? textWithFolderPaths(referenceText, loosePaths) : undefined,
      ),
    };
  });
  const formats: Record<string, Promise<Blob>> = {
    "text/plain": content.then(() => new Blob([payload], { type: "text/plain" })),
    "text/html": content.then(({ html }) => html),
  };
  // A native bitmap can make other editors treat a mixed clipboard as an image paste.
  // Keep the bitmap representation for image-only copies.
  const pngIndex = fileAttachments.findIndex((file) => file.mimeType === "image/png");
  if (!payload.trim() && pngIndex >= 0) {
    formats["image/png"] = content.then(
      ({ files }) => new Blob([decodeBase64(files[pngIndex].data)], { type: "image/png" }),
    );
  }
  const write = async () => navigator.clipboard.write([new ClipboardItem(formats)]);
  // Observe the data promises even when the browser refuses the write before reading them.
  await Promise.all([...Object.values(formats), write()]);
}

async function loadCopiedFiles(attachments: Attachment[]): Promise<CopiedFile[]> {
  const files: CopiedFile[] = [];
  let decodedBytes = 0;
  for (const attachment of attachments) {
    try {
      let data = attachment.data;
      if (data === undefined && attachment.loadPreview) {
        data = await attachment.loadPreview();
      } else if (
        data === undefined &&
        attachment.path &&
        !attachment.hostEnvironmentId &&
        !attachment.path.startsWith(REMOTE_PATH_PREFIX)
      ) {
        data = await invoke<string>("read_file_base64", {
          path: attachment.path,
        });
      }
      if (data === undefined) throw new Error("File content is no longer available.");
      decodedBytes += embeddedByteLength(data);
      if (decodedBytes > MAX_EMBED_BYTES)
        throw new Error(
          "Copied attachments exceed the combined 20 MB clipboard limit. Copy fewer files.",
        );
      if (files.length >= MAX_ATTACHMENTS)
        throw new Error(
          `A clipboard message supports up to ${MAX_ATTACHMENTS} files. Copy fewer files.`,
        );
      files.push({
        name: attachment.name,
        mimeType: attachment.mimeType,
        data,
      });
    } catch (error) {
      const reason = errorText(error);
      throw new Error(`Could not copy ${attachment.name}: ${reason}`);
    }
  }
  return files;
}

/** Copy an attachment as an OS bitmap. Clipboard image writes require PNG. */
export async function copyAttachmentImage(attachment: Attachment): Promise<void> {
  const image = loadCopiedFiles([attachment]).then(([file]) => clipboardPng(file));
  const write = async () => navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
  // WebKit needs the write to begin during the menu activation, before the bytes arrive.
  await withTimeout(Promise.all([image, write()]), 30_000, "Image clipboard write");
}

async function clipboardPng(file: CopiedFile): Promise<Blob> {
  const blob = new Blob([decodeBase64(file.data)], { type: file.mimeType });
  if (file.mimeType === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    // Bound canvas allocation even when a compressed file fits the byte budget.
    if (!width || !height || width * height > 64_000_000) {
      throw new Error("Image dimensions are too large to copy.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("Could not convert the image to PNG."));
      });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function messageClipboardHtml(payload: string, files: CopiedFile[], referenceText?: string): Blob {
  // Each file's bytes are embedded once, as the data URI of its <img>/<a>; the paste side reads
  // them back from there. The base64 is already validated, so it needs no escaping, and the
  // parts go to the Blob as they are instead of being joined into one more copy.
  const pre = referenceText ? `<pre ${REFERENCE_ATTRIBUTE}${escapeHtml(referenceText)}">` : "<pre>";
  const parts: string[] = [`<div>${pre}${escapeHtml(payload)}</pre>`];
  let htmlLength = parts[0].length;
  for (const file of files) {
    const name = escapeHtml(file.name);
    const uri = `${DATA_URI_PREFIX}${escapeHtml(file.mimeType)}${BASE64_MARKER}`;
    const open = file.mimeType.startsWith("image/")
      ? `<img ${FILE_ATTRIBUTE}${name}" src="${uri}`
      : `<a ${FILE_ATTRIBUTE}${name}" href="${uri}`;
    const close = file.mimeType.startsWith("image/") ? `">` : `" download="${name}">${name}</a>`;
    parts.push(open, file.data, close);
    htmlLength += open.length + file.data.length + close.length;
  }
  parts.push("</div>");
  htmlLength += "</div>".length;
  if (htmlLength > MAX_CLIPBOARD_HTML_CHARS)
    throw new Error("The copied message is too large. Copy less text or fewer files.");
  return new Blob(parts, { type: "text/html" });
}

type ClipboardMessage = { text: string; files: File[]; referenceText?: string };

export function messageFromClipboard(
  clipboard: Pick<DataTransfer, "getData">,
): ClipboardMessage | null {
  const files = messageFilesFromClipboard(clipboard);
  if (!files?.length) return null;
  // Older copies included the source message's tokens in the plain text.
  const text = stripAttachmentTokens(
    clipboard.getData("text/plain"),
    files.map(({ type, size }) => ({ kind: type.startsWith("image/") ? "image" : "file", size })),
  );
  const html = clipboard.getData("text/html");
  const marker = html.indexOf(REFERENCE_ATTRIBUTE);
  if (marker < 0) return { text, files };
  const start = marker + REFERENCE_ATTRIBUTE.length;
  const end = html.indexOf('"', start);
  return {
    text,
    files,
    referenceText: end > start ? unescapeHtml(html.slice(start, end)) : undefined,
  };
}

/** Replace clipboard-local references with the receiving draft's actual attachment numbers. */
export function clipboardTextWithAttachments(
  message: ClipboardMessage,
  incoming: Attachment[],
  attachments: Attachment[],
): string | undefined {
  if (!message.referenceText || incoming.length !== message.files.length) return;
  const slots = incoming.map((file) => attachments.findIndex(({ id }) => id === file.id));
  if (slots.includes(-1)) return;
  const files = incoming.map((file, index) => ({ ...file, id: `clipboard-${index}` }));
  const matches = findTokens(message.referenceText, files).filter(({ token }) =>
    token.includes("; ref=clipboard-"),
  );
  if (!matches.length) return;
  const tokens = attachmentDraftTokens(attachments);
  const referenced = new Set(matches.map(({ index }) => index));
  const text = rewriteTokenMatches(
    message.referenceText,
    matches,
    ({ index }) => tokens[slots[index]],
  );
  const extra = slots.flatMap((slot, index) => (referenced.has(index) ? [] : [tokens[slot]]));
  return [text, ...extra].join(" ");
}

/** Only embedded bytes are accepted; clipboard HTML cannot request local paths. */
export function messageFilesFromClipboard(clipboard: Pick<DataTransfer, "getData">): File[] | null {
  try {
    const html = clipboard.getData("text/html");
    if (!html || html.length > MAX_LEGACY_HTML_CHARS) return null;
    let cursor = html.indexOf(FILE_ATTRIBUTE);
    if (cursor < 0) return legacyMessageFiles(html);
    if (html.length > MAX_CLIPBOARD_HTML_CHARS) return null;
    // Walk the markers with indexOf: no DOM parse and no copy of the base64 until it is decoded.
    const files: CopiedFile[] = [];
    let decodedBytes = 0;
    while (cursor >= 0) {
      if (files.length >= MAX_ATTACHMENTS) return null;
      const nameStart = cursor + FILE_ATTRIBUTE.length;
      const nameEnd = html.indexOf('"', nameStart);
      const uriStart = html.indexOf(DATA_URI_PREFIX, nameEnd);
      if (nameEnd < 0 || uriStart < 0) return null;
      const mimeStart = uriStart + DATA_URI_PREFIX.length;
      const mimeEnd = html.indexOf(BASE64_MARKER, mimeStart);
      if (mimeEnd < 0) return null;
      const dataStart = mimeEnd + BASE64_MARKER.length;
      const dataEnd = html.indexOf('"', dataStart);
      if (dataEnd < 0) return null;
      const data = html.slice(dataStart, dataEnd);
      decodedBytes += embeddedByteLength(data);
      if (decodedBytes > MAX_EMBED_BYTES) return null;
      files.push({
        name: unescapeHtml(html.slice(nameStart, nameEnd)),
        mimeType: unescapeHtml(html.slice(mimeStart, mimeEnd)),
        data,
      });
      cursor = html.indexOf(FILE_ATTRIBUTE, dataEnd);
    }

    return files.map(
      (file) => new File([decodeBase64(file.data)], file.name, { type: file.mimeType }),
    );
  } catch {
    return null;
  }
}

function legacyMessageFiles(html: string): File[] | null {
  const marker = html.indexOf(LEGACY_FILES_ATTRIBUTE);
  if (marker < 0) return null;
  const start = marker + LEGACY_FILES_ATTRIBUTE.length;
  const end = html.indexOf('"', start);
  if (end <= start || end - start > MAX_LEGACY_PAYLOAD_CHARS) return null;
  const files: unknown = JSON.parse(decodeURIComponent(html.slice(start, end)));
  if (!Array.isArray(files) || files.length > MAX_ATTACHMENTS) return null;

  let decodedBytes = 0;
  for (const file of files) {
    if (
      typeof file?.name !== "string" ||
      typeof file?.mimeType !== "string" ||
      typeof file?.data !== "string"
    ) {
      return null;
    }
    decodedBytes += embeddedByteLength(file.data);
    if (decodedBytes > MAX_EMBED_BYTES) return null;
  }
  return files.map(
    (file) => new File([decodeBase64(file.data)], file.name, { type: file.mimeType }),
  );
}

/** A WebView clipboard write that never settles must not leave a copy action pending forever. */
const BROWSER_CLIPBOARD_DEADLINE_MS = 1500;
const NATIVE_CLIPBOARD_DEADLINE_MS = 5000;

export async function copyText(text: string): Promise<void> {
  try {
    await withTimeout(
      navigator.clipboard.writeText(text),
      BROWSER_CLIPBOARD_DEADLINE_MS,
      "Clipboard write",
    );
  } catch {
    // WebView clipboard permission/focus can fail (or hang) while the native clipboard
    // remains available. Keep browser previews independent of the desktop API.
    if ("__TAURI_INTERNALS__" in window) {
      try {
        await withTimeout(
          invoke("copy_text_to_clipboard", { text }),
          NATIVE_CLIPBOARD_DEADLINE_MS,
          "Native clipboard write",
        );
        return;
      } catch {
        // Older installed backends may not have this command yet.
      }
    }
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
      : [];
    try {
      el.focus({ preventScroll: true });
      el.select();
      if (!document.execCommand("copy")) throw new Error("Could not copy text. Please try again.");
    } finally {
      el.remove();
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        ranges.forEach((range) => selection.addRange(range));
      }
    }
  }
}

/**
 * True when the clipboard text is a file reference rather than prose, so a
 * file-manager copy is not mistaken for a text paste.
 *
 * A file manager that also publishes plain text publishes the path as a
 * `file://` URI, so that is the only shape treated as a reference. Anything
 * else — including a URL from "copy image" in a browser — is a text paste.
 */
export function isFileReferenceText(text: string): boolean {
  return text.trim().toLowerCase().startsWith("file:");
}

export type NativeClipboardPaste = {
  files: Attachment[];
  /** Set when the clipboard held more copies than one turn can carry. */
  warning?: string;
};

/**
 * Attachments for copied paths, filling a turn's quota with whatever the
 * filesystem actually accepts, plus how many paths it took to get there.
 *
 * A path that was moved or deleted yields no attachment, so paths are taken a
 * batch at a time until the quota is met. Counting them before converting would
 * drop a good file that sat behind an unreadable one.
 */
async function attachmentsFromClipboardPaths(paths: string[], capacity?: AttachmentReadCapacity) {
  const files: Attachment[] = [];
  let consumed = 0;
  while (
    consumed < paths.length &&
    files.length < MAX_ATTACHMENTS &&
    (!capacity || capacity.remaining() > 0)
  ) {
    const batch = paths.slice(consumed, consumed + MAX_ATTACHMENTS);
    for (const file of await attachmentsFromPaths(batch, capacity)) {
      if (files.length >= MAX_ATTACHMENTS) break;
      files.push(file);
    }
    consumed += batch.length;
  }
  return { files, consumed };
}

/**
 * Attachments for a paste the webview reported without a single file.
 *
 * `text` is what the webview saw on the clipboard. Copies made in a file
 * manager and screenshots reach us only through the native clipboard, so try
 * paths before image bytes; an image is only worth reading when the paste
 * carried no text at all.
 */
export async function nativeClipboardAttachments(
  text: string,
  capacity?: AttachmentReadCapacity,
): Promise<NativeClipboardPaste> {
  const paths = await readClipboardFilePaths();
  if (paths.length) {
    const { files, consumed } = await attachmentsFromClipboardPaths(paths, capacity);
    if (
      !files.length &&
      consumed === paths.length &&
      !capacity?.notice() &&
      !capacity?.matchedPendingPath
    )
      throw new Error(
        `Nothing to attach. The ${
          paths.length === 1 ? "file" : "files"
        } may have been moved, renamed, or deleted.`,
      );
    return {
      files,
      ...(consumed < paths.length
        ? {
            warning: `Attached ${files.length} of ${paths.length} copied files. A turn carries up to ${MAX_ATTACHMENTS}.`,
          }
        : {}),
    };
  }
  if (text) return { files: [] };
  if (capacity?.remaining() === 0)
    return { files: [], warning: t("Attachment limit reached ({p0})", { p0: MAX_ATTACHMENTS }) };
  // An empty clipboard is a no-op. A real read failure still surfaces.
  const image = await readClipboardImage();
  return { files: image ? await attachmentsFromFiles([image], { capacity }) : [] };
}

/**
 * Paths for files copied in a file manager, empty when the clipboard holds
 * none. Rejects when the clipboard cannot be read, so a failure reaches the
 * composer instead of looking like an empty clipboard.
 *
 * Invokes the command directly rather than through `fs.clipboardFilePaths`:
 * that module pulls in the dialog plugin, which nothing here needs.
 */
export async function readClipboardFilePaths(): Promise<string[]> {
  const paths = await invoke<string[]>("clipboard_file_paths");
  return Array.isArray(paths) ? paths.filter((path) => path.trim()) : [];
}

/** The Host's reply when the clipboard holds no image (`src-tauri/src/pasteboard.rs`). Matched only here. */
const EMPTY_CLIPBOARD_IMAGE = "The clipboard does not contain an image.";

/**
 * An image held by the native clipboard, as a `File`, or `null` when the
 * clipboard holds no image.
 *
 * A webview's paste event carries text only, so images copied by a screenshot
 * tool never reach `clipboardData.files`. Other read failures throw with a
 * message worth showing.
 */
export async function readClipboardImage(): Promise<File | null> {
  let buffer: ArrayBuffer;
  try {
    buffer = await invoke<ArrayBuffer>("clipboard_image");
  } catch (error) {
    const reason = errorText(error);
    if (reason === EMPTY_CLIPBOARD_IMAGE) return null;
    throw new Error(reason || "The clipboard could not be read.");
  }
  if (!buffer?.byteLength) return null;
  return new File([buffer], "clipboard-image.png", { type: "image/png" });
}
