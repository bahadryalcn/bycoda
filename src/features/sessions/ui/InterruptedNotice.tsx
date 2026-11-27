import { memo } from "react";
import { useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Pause } from "../../../shared/ui/icons";
import { claimAutoContinue } from "../model/autoContinue";
import { executionUserIndex } from "../model/executionTurn";
import { catalogText } from "../model/catalogText";
import { canAutoContinue } from "../model/inFlight";
import type { Session } from "../model/session";
import { NoticeActionButton, TranscriptNotice } from "./TranscriptNotice";

/**
 * The latest turn ended because the owner pressed Stop: its prompt carries the stopped mark and
 * no later prompt, Continue or answer has started another turn since. Stop itself is not a
 * failure, so the notice is quiet and Continue is the owner's call.
 */
export function isOwnerStoppedLatestTurn(session: Session): boolean {
  if (session.busy || session.continuingElsewhere || session.worktreeRemoved) return false;
  const blocks = session.blocks.filter((block) => !block.draft);
  const owner = executionUserIndex(blocks);
  if (owner < 0 || blocks[owner].turnOutcome !== "stopped") return false;
  // A later prompt that is not a steer or answer started another turn.
  return !blocks.slice(owner + 1).some((block) => block.role === "user" && !block.continuationOf);
}

/**
 * A turn that was cut off when Bycoda quit, and was not continued on its own:
 * the setting is off, the transcript did not settle whether it ended, or the
 * user had follow-ups queued. Continue is the user's call. A host chat shows it
 * too when the host recorded the turn as lost.
 */
export const InterruptedNotice = memo(function InterruptedNotice({
  session,
  interruptedTurn,
  blockedReason,
  onContinue,
  message,
}: {
  session: Session;
  interruptedTurn?: boolean;
  blockedReason?: string;
  onContinue: () => void;
  message?: string;
}) {
  const t = useT();
  // A pending automatic continuation is only intent. Recovery holds or window
  // transfers can prevent its dispatch, so keep manual recovery available until
  // a new turn actually starts.
  const ownerStopped = isOwnerStoppedLatestTurn(session);
  if (
    !ownerStopped &&
    (session.busy ||
      session.continuingElsewhere ||
      session.worktreeRemoved ||
      !(interruptedTurn ?? canAutoContinue(session)))
  )
    return null;
  // Continue resumes the provider thread, so a stopped turn without one has nothing to resume.
  const canContinue = !ownerStopped || !!session.providerSessionId;
  return (
    <TranscriptNotice
      data-interrupted-turn
      kind="neutral"
      icon={<Pause className="icon-md" aria-hidden />}
      data-owner-stopped={ownerStopped ? "" : undefined}
      title={ownerStopped ? t("You stopped this turn") : t("Interrupted")}
      detail={
        ownerStopped
          ? t("Continue to pick up where it left off, or send a new message.")
          : message
            ? catalogText(t, message)
            : t("This turn was cut off when {p0} quit.", { p0: PRODUCT_IDENTITY.displayName })
      }
      actions={
        canContinue ? (
          <NoticeActionButton
            action={{
              label: t("Continue"),
              disabled: !!blockedReason,
              disabledReason: blockedReason,
              onClick: () => {
                // Consume the pending automatic send before submitting manually.
                claimAutoContinue(session.id);
                onContinue();
              },
            }}
          />
        ) : undefined
      }
    />
  );
});
