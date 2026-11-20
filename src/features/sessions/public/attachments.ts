/** Public sessions contract; exports stay explicit to preserve load isolation. */
export {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  MAX_ATTACHMENTS,
  MAX_EMBED_BYTES,
  persistableAttachment,
  pickAttachments,
  retainAttachmentPickerSelection,
  revokeAttachment,
} from "../model/attachments";
