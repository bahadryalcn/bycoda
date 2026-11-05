/** Public files contract; exports stay explicit to preserve load isolation. */
export {
  applyFileMentionsToTurn,
  buildMentionIndex,
  fileMentionParts,
  mentionLabel,
  mentionTokenAt,
  rankMentionFiles,
  replaceMentionToken,
} from "../model/fileMentions";
export type { MentionIndex, MentionToken } from "../model/fileMentions";
