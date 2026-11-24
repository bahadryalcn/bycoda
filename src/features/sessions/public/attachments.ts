/** Public sessions contract; exports stay explicit to preserve load isolation. */
export {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  isAttachmentFolder,
  MAX_ATTACHMENTS,
  MAX_EMBED_BYTES,
  mergeAttachments,
  persistableAttachment,
  pickAttachments,
  retainAttachmentPickerSelection,
  revokeAttachment,
} from "../model/attachments";
export {
  attachmentDraftTokens,
  findTokens,
  rewriteTokenMatches,
  stripAttachmentTokens,
} from "../model/attachmentTokens";
export type { Attachment } from "../model/session";
export { beginAttachmentRead, type AttachmentReadCapacity } from "../model/attachmentReadCapacity";
export { capturePastedTextAttachment, replacePastedText } from "../model/pastedTextAttachment";
