import { memo } from "react";
import { useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Pause, Play } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
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
    <div className="px-2 text-(--ui-text-secondary)" data-interrupted-turn>
      <div className="relative z-0 flex h-8 items-center gap-2 rounded-t-xl border border-b-0 border-(--ui-tone-warning-border) bg-(--ui-tone-warning-subtle) px-2 text-ui-caption">
        <Pause className="size-3.5 shrink-0 text-(--ui-tone-warning-fg)" />
        <span className="shrink-0 text-(--ui-text-secondary)">{t("Interrupted")}</span>
        <span
          className="min-w-0 flex-1 truncate"
          title={
            message
              ? t(message)
              : t("This turn was cut off when {p0} quit.", { p0: PRODUCT_IDENTITY.displayName })
          }
        >
          {message
            ? t(message)
            : t("This turn was cut off when {p0} quit.", { p0: PRODUCT_IDENTITY.displayName })}
        </span>
        <Button
          variant="secondary"
          disabled={!!blockedReason}
          tooltip={blockedReason}
          startIcon={<Play className="size-3.5" />}
          onClick={() => {
            // Consume the pending automatic send before submitting manually.
            claimAutoContinue(session.id);
            onContinue();
          }}
        >
          {t("Continue")}
        </Button>
      </div>
    </div>
  );
});
