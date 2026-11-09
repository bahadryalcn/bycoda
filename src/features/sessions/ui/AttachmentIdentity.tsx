import { AudioLines, Play, ImagePlus } from "../../../shared/ui/icons";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { attachmentPresentation } from "../model/attachmentPresentation";
import type { Attachment } from "../model/session";

export function AttachmentIdentity({
  attachment,
  size = 24,
}: {
  attachment: Attachment;
  /** `token` fits the composer's text overlay; `pill` fits a message's attachment pill. */
  size?: number | "token" | "pill";
}) {
  const iconSize = size === "token" ? 9 : size === "pill" ? 13 : size;
  const { kind, extension } = attachmentPresentation(attachment);
  const Icon =
    kind === "audio" ? AudioLines : kind === "video" ? Play : kind === "image" ? ImagePlus : null;
  return Icon ? (
    <Icon style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
  ) : (
    <FileTypeIcon
      name={
        kind === "pdf"
          ? "attachment.pdf"
          : kind === "markdown"
            ? "attachment.md"
            : !extension && kind === "archive"
              ? "attachment.zip"
              : attachment.name
      }
      isDir={kind === "folder"}
      size={iconSize}
    />
  );
}
