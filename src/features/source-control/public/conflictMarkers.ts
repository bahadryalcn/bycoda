/** Public source-control contract; exports stay explicit to preserve load isolation. */
export {
  conflictReplacement,
  findConflictBlocks,
  hasConflictMarkers,
} from "../model/conflictMarkers";
export type { ConflictBlock, ConflictSide } from "../model/conflictMarkers";
