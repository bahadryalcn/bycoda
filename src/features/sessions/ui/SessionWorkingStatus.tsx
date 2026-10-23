import { useT } from "../../../shared/i18n";
import { formatLiveElapsed } from "../model/liveAgents";
import { useSharedNow } from "./AgentClock";
import { usePresentationVisible } from "./presentationVisibility";
import { TerminalSpinner } from "./TerminalSpinner";

/** The same working indicator and turn clock in rail rows and session cards. */
export function SessionWorkingStatus({ startedAt }: { startedAt?: number }) {
  const t = useT();
  // A hidden pane keeps no ticker; showing it reads the clock afresh.
  const visible = usePresentationVisible();
  const now = useSharedNow(startedAt != null && visible);
  const elapsed = startedAt != null && now > 0 ? formatLiveElapsed(startedAt, now) : null;
  return (
    <span
      data-session-working-status
      role="img"
      aria-label={[t("Working"), elapsed].filter(Boolean).join(", ")}
      title={t("Working")}
      className="inline-flex shrink-0 items-center gap-1 text-ui-micro text-(--color-active)"
    >
      <TerminalSpinner className="inline-block w-3 select-none text-center text-ui-micro leading-none" />
      {elapsed ? (
        <span className="shrink-0 tabular-nums">{elapsed}</span>
      ) : null}
    </span>
  );
}
