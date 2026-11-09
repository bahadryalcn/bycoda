import type { Session } from "./session";
import { canEditLastTurn, lastEditableTurnStartIndex, lastUserTurnBlock } from "./editLastTurn";

/** Native APIs replace a whole final turn; earlier messages use a fresh context. */
export function conversationRewindStrategy(
  session: Session & { managedWorkspaceId?: string; workspaceId?: string },
  blockId: string,
  nativeAvailable: boolean,
  managedWorkspace = !!(session.managedWorkspaceId || session.workspaceId),
) {
  if (
    !managedWorkspace &&
    !session.managedWorkspaceId &&
    !session.workspaceId &&
    nativeAvailable &&
    session.providerSessionId &&
    !session.pendingContextReplay &&
    canEditLastTurn(session) &&
    lastUserTurnBlock(session.blocks)?.id === blockId
  ) {
    return {
      blockId: session.blocks[lastEditableTurnStartIndex(session)].id,
      preserveProviderBinding: true,
      providerTurnId: lastUserTurnBlock(session.blocks)?.providerTurnId,
    };
  }
  return { blockId, preserveProviderBinding: false, providerTurnId: undefined };
}
