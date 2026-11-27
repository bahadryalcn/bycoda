import { createContext } from "react";
import type { BranchBlockedReason } from "../model/conversationBranch";
import type { Block } from "../model/session";

/**
 * What a transcript needs to branch a conversation: the owning pane provides it, so the turn actions and the origin
 * row of a branch reach it without threading three props through every transcript layer. Absent where branching does
 * not apply (a Host-owned conversation), which leaves the action out.
 */
export type TranscriptBranch = {
  /** Why this reply cannot be branched, or undefined when it can. */
  blockedReason: (turn: readonly Block[]) => BranchBlockedReason | undefined;
  /** Branches the session through the end of this reply into a new tab. */
  branch: (turn: Block[]) => void;
  /** Opens the session a branch was cut from, at that reply. */
  openSource: (sessionId: string, blockId: string) => void;
};

export const TranscriptBranchContext = createContext<TranscriptBranch | null>(null);
