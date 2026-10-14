import { t, useLocale } from "../../../shared/i18n";
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
export function InterruptedNotice({
  session,
  interruptedTurn,
  blockedReason,
  onContinue,
  message = `This turn was cut off when ${PRODUCT_IDENTITY.displayName} quit.`,
}: {
  session: Session;
  interruptedTurn?: boolean;
  blockedReason?: string;
  onContinue: () => void;
  message?: string;
}) {
  useLocale();
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
    <div className="px-2 text-content/55" data-interrupted-turn>
      <div className="relative z-0 flex h-8 items-center gap-2 rounded-t-[10px] border border-b-0 border-warning/25 bg-warning/10 px-2 text-[12px]">
        <Pause className="size-3.5 shrink-0 text-warning" />
        <span className="shrink-0 text-content/85">{t("Interrupted")}</span>
        <span className="min-w-0 flex-1 truncate">{message}</span>
        <Button
          variant="ghost"
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
}
