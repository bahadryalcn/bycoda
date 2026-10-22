import { t, useLocale } from "../../../shared/i18n";
import { formatLiveElapsed } from "../model/liveAgents";
import { useSharedNow } from "./AgentClock";
import { TerminalSpinner } from "./TerminalSpinner";

/** The same working indicator and turn clock in rail rows and session cards. */
export function SessionWorkingStatus({ startedAt }: { startedAt?: number }) {
  useLocale();
  const now = useSharedNow(startedAt != null);
  const elapsed = startedAt != null ? formatLiveElapsed(startedAt, now) : null;
  return (
    <span
      data-session-working-status
      role="img"
      aria-label={[t("Working"), elapsed].filter(Boolean).join(", ")}
      title={t("Working")}
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-(--color-active)"
    >
      <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none" />
      {elapsed ? (
        <span className="shrink-0 tabular-nums">{elapsed}</span>
      ) : null}
    </span>
  );
}
