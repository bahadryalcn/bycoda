import type { Block, Session } from "./session";
import { isProviderFailureText } from "./plan";

/** Older hosts saved writer rejection as untagged system text. Keep those
 * persisted failures visible and retryable without rewriting user history. */
export function isSessionErrorBlock(block: Block): boolean {
  return (
    block.role === "system" &&
    (block.notice === "error" ||
      (!block.notice &&
        !block.interjection &&
        !block.shell &&
        /^thread \S+ already has an active writer\s*$/i.test(block.text.trim())))
  );
}

/** Only the latest submitted turn can require attention. */
export function sessionIssue(session: Session): "retrying" | "failed" | undefined {
  if ((session.busy || session.continuingElsewhere) && session.retryMessage) return "retrying";
  if (session.usageLimit) return "failed";
  let reply: string | undefined;
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user" && !block.draft) break;
    if (isSessionErrorBlock(block)) return "failed";
    if (reply === undefined && block.role === "assistant" && block.text.trim()) reply = block.text;
  }
  if (!session.busy && !session.continuingElsewhere && isProviderFailureText(reply ?? ""))
    return "failed";
  return undefined;
}
