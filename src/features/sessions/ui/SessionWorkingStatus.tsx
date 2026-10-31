import { useT } from "../../../shared/i18n";
import { formatLiveElapsed } from "../model/liveAgents";
import { useSharedNow } from "./AgentClock";
import { usePresentationVisible } from "./presentationVisibility";
import { TerminalSpinner } from "./TerminalSpinner";

/** The same working indicator and turn clock in rail rows and session cards. */
export function SessionWorkingStatus({
  startedAt,
  showElapsed = true,
  labelled = false,
}: {
  startedAt?: number;
  /** Rows that print the turn time elsewhere keep only the working mark here. */
  showElapsed?: boolean;
  /**
   * Prints "Working" beside the mark and takes the enclosing badge's text color. Session
   * lists hide the word on narrow sidebars (sessionList.css); the mark and time stay.
   */
  labelled?: boolean;
}) {
  const t = useT();
  // A hidden pane keeps no ticker; showing it reads the clock afresh.
  const visible = usePresentationVisible();
  const now = useSharedNow(showElapsed && startedAt != null && visible);
  const elapsed =
    showElapsed && startedAt != null && now > 0 ? formatLiveElapsed(startedAt, now) : null;
  return (
    <span
      data-session-working-status
      role="img"
      aria-label={[t("Working"), elapsed].filter(Boolean).join(", ")}
      title={t("Working")}
      className={`inline-flex shrink-0 items-center gap-1 ${
        labelled ? "" : "text-ui-micro text-(--color-active)"
      }`}
    >
      <TerminalSpinner />
      {labelled ? (
        <span aria-hidden className="session-working-label">
          {t("Working")}
        </span>
      ) : null}
      {elapsed ? <span className="shrink-0 tabular-nums">{elapsed}</span> : null}
    </span>
  );
}
