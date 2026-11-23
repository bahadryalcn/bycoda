/** Public sessions contract; exports stay explicit to preserve load isolation. */
export {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  isAttachmentFolder,
  MAX_ATTACHMENTS,
  MAX_EMBED_BYTES,
  persistableAttachment,
  pickAttachments,
  retainAttachmentPickerSelection,
  revokeAttachment,
} from "../model/attachments";
export {
  attachmentDraftTokens,
  findTokens,
  rewriteTokenMatches,
  splitNamedAttachmentReferences,
  stripAttachmentTokens,
} from "../model/attachmentTokens";
export type { Attachment } from "../model/session";
export { capturePastedTextAttachment, replacePastedText } from "../model/pastedTextAttachment";
