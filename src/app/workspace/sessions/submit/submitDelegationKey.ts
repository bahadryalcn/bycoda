import { delegationRequestKey } from "../../../../features/sessions/model/crewMentions";
import type { Session } from "../../../../features/sessions/model/session";
import type { SubmitOptions } from "../../helpers/types";

/** The identity a send's `@member` and `@crew` delegations repeat when the same send is retried. */
export function submitDelegationKey(
  sessionId: string,
  options: SubmitOptions | undefined,
  session: Pick<Session, "blocks">,
): string {
  return delegationRequestKey({
    sessionId,
    queuedMessageId: options?.queuedMessageId,
    appRequestId: options?.appRequestId,
    userTurns: session.blocks.filter((block) => block.role === "user" && !block.draft).length,
  });
}
