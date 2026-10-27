import { isRemoteProjectPath } from "../../projects/model/recents";
import type { Block } from "./session";

/** Include persisted pre-upgrade notices and current native admission/transport failures. */
export function isManagedTurnFailure(text: string): boolean {
  return /A different managed turn is still active|Managed turn (?:could not (?:start|finish)|recovery)|The managed writer could not be retired|Conversation changed before managed turn capture|Another workspace writer or unknown activity is still active|Native turn (?:activity is missing|has no complete before capture|belongs to another owner device|identity changed|conversation revision changed)|Unknown accepted native turn|Accepted native turn identity changed/i.test(
    text,
  );
}

export function managedTurnRecoveryNotice({
  sessionId,
  managedWorkspaceId,
  cwd,
  busy,
  blocks,
}: {
  sessionId?: string;
  managedWorkspaceId?: string;
  cwd?: string;
  busy?: boolean;
  blocks: Block[];
}) {
  if (!sessionId || !managedWorkspaceId || busy || !cwd || isRemoteProjectPath(cwd)) return;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.draft) continue;
    if (block.role === "user" || (block.role === "assistant" && block.text.trim())) return;
    if (
      block.role === "system" &&
      !block.shell &&
      !block.interjection &&
      isManagedTurnFailure(block.text)
    )
      return { sessionId, errorId: block.id };
  }
}
