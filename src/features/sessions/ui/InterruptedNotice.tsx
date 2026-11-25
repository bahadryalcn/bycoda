import { memo } from "react";
import { useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Alert } from "../../../shared/ui/Alert";
import { Pause } from "../../../shared/ui/icons";
import { claimAutoContinue } from "../model/autoContinue";
import { canAutoContinue } from "../model/inFlight";
import type { Session } from "../model/session";

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
  if (
    session.busy ||
    session.continuingElsewhere ||
    session.worktreeRemoved ||
    !(interruptedTurn ?? canAutoContinue(session))
  )
    return null;
  return (
    <Alert
      data-interrupted-turn
      actionsAlign="center"
      tone="warning"
      title={t("Interrupted")}
      icon={<Pause className="icon-md" aria-hidden />}
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
    >
      {message
        ? t(message)
        : t("This turn was cut off when {p0} quit.", { p0: PRODUCT_IDENTITY.displayName })}
    </Alert>
  );
});
