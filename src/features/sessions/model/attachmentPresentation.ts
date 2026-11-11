export { formatAttachmentSize } from "../../../shared/i18n/format";
import type { Attachment } from "./session";

export type AttachmentPresentationKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "markdown"
  | "text"
  | "spreadsheet"
  | "code"
  | "archive"
  | "folder"
  | "file";

const labels = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
  markdown: "Markdown",
  text: "Text",
  spreadsheet: "Spreadsheet",
  code: "Code",
  archive: "Compressed archive",
  folder: "Folder",
  file: "File",
} as const;

const extensionTypeKinds = new Set<AttachmentPresentationKind>([
  "spreadsheet",
  "text",
  "code",
  "archive",
  "file",
]);

const extensions: Partial<Record<string, AttachmentPresentationKind>> = {};
for (const [kind, names] of Object.entries({
  image: "png jpg jpeg gif webp avif heic heif bmp ico tif tiff svg",
  audio: "mp3 wav ogg oga m4a aac flac opus aiff wma",
  video: "mp4 webm mov m4v avi mkv mpg mpeg ogv 3gp",
  pdf: "pdf",
  markdown: "md markdown mdx mdown",
  text: "txt text log rtf",
  spreadsheet: "csv tsv xls xlsx ods numbers",
  code: "js jsx ts tsx mjs cjs json jsonc html htm css scss sass less xml yaml yml toml py rb rs go java kt kts swift c h cpp hpp cs php sh bash zsh ps1 sql vue svelte ipynb",
  archive: "zip gz gzip tgz tar bz2 xz 7z rar zst",
})) {
  for (const name of names.split(" ")) extensions[name] = kind as AttachmentPresentationKind;
}

/** UI metadata only. Does not change provider attachment kinds or token identities. */
export function attachmentPresentation(attachment: Pick<Attachment, "name" | "mimeType" | "kind">) {
  const basename = attachment.name.split(/[\\/]/).pop() ?? attachment.name;
  const dot = basename.lastIndexOf(".");
  const extension = dot > 0 ? basename.slice(dot + 1).toLowerCase() : "";
  const mime = attachment.mimeType.split(";", 1)[0].trim().toLowerCase();
  let kind: AttachmentPresentationKind;

  if (mime === "inode/directory") kind = "folder";
  else if (mime.startsWith("image/")) kind = "image";
  else if (mime.startsWith("audio/")) kind = "audio";
  else if (mime.startsWith("video/")) kind = "video";
  else if (mime === "application/pdf") kind = "pdf";
  else if (mime === "text/markdown" || mime === "text/x-markdown") kind = "markdown";
  else if (
    /^(?:text\/(?:csv|tab-separated-values)|application\/(?:vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.oasis\.opendocument\.spreadsheet))$/.test(
      mime,
    )
  )
    kind = "spreadsheet";
  else if (
    /^application\/(?:zip|x-zip-compressed|gzip|x-gzip|x-tar|x-bzip2|x-xz|x-7z-compressed|x-rar-compressed|vnd\.rar|zstd)$/.test(
      mime,
    )
  )
    kind = "archive";
  else if (
    /^(?:application\/(?:json|ld\+json|xml|javascript|typescript|x-yaml)|text\/(?:javascript|typescript|html|css|xml|x-python|x-shellscript))$/.test(
      mime,
    )
  )
    kind = "code";
  else if (attachment.kind === "image" || attachment.kind === "audio") kind = attachment.kind;
  else kind = extensions[extension] ?? (mime.startsWith("text/") ? "text" : "file");

  const shownExtension = kind === "folder" ? "" : extension;
  return {
    kind,
    label: labels[kind],
    extension: shownExtension,
    // Broad kinds read better as the real format ("CSV", "ZIP"); null keeps the translated label.
    typeExtension:
      extensionTypeKinds.has(kind) && shownExtension ? shownExtension.toUpperCase() : null,
  };
}
