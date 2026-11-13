import { actionContentAttributes } from "../../../shared/ui/ActionHost";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { useT } from "../../../shared/i18n";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { formatLiveMinutes } from "../model/liveAgents";
import { usePresentationVisible } from "./presentationVisibility";
import { Clock } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import { sessionWaitReason, type SessionWait } from "../model/sessionWait";
import { TerminalSpinner } from "./TerminalSpinner";

/** The same working indicator and turn clock in rail rows and session cards. */
export function SessionWorkingStatus({
  startedAt,
  showElapsed = true,
  labelled = false,
  wait,
}: {
  startedAt?: number;
  /** Rows that print the turn time elsewhere keep only the working mark here. */
  showElapsed?: boolean;
  /**
   * Prints "Working" beside the mark and takes the enclosing badge's text color. Session
   * lists hide the word on narrow sidebars (sessionList.css); the mark and time stay.
   */
  labelled?: boolean;
  /** The agent yielded and background work holds the turn: a still mark and "Waiting". */
  wait?: SessionWait;
}) {
  const t = useT();
  // A hidden pane keeps no ticker; showing it reads the clock afresh.
  const visible = usePresentationVisible();
  // Minute precision: rail rows and cards re-render once a minute, not every second.
  // The minute tick only triggers the render; the label reads the exact time.
  const since = wait ? (wait.since ?? startedAt) : startedAt;
  const now = useMinuteNow(showElapsed && since != null && visible) ? wallClockNow() : 0;
  const elapsed = showElapsed && since != null && now > 0 ? formatLiveMinutes(since, now) : null;
  const word = t(wait ? "Waiting" : "Working");
  const reason = wait ? sessionWaitReason(wait) : word;
  return (
    <Tooltip label={[reason, elapsed].filter(Boolean).join(", ")} asChild>
      <Text
        as="span"
        size={labelled ? "inherit" : "micro"}
        tone="inherit"
        data-session-working-status
        data-session-waiting={wait ? "" : undefined}
        role="img"
        aria-label={[reason, elapsed].filter(Boolean).join(", ")}

        className={`inline-flex shrink-0 items-center gap-1 ${
          labelled ? "" : "text-(--color-active)"
        }`}
      >
        {wait ? <Clock className="icon-xs" strokeWidth={1.75} aria-hidden /> : <TerminalSpinner />}
        {labelled ? (
          <span
            aria-hidden
            {...actionContentAttributes(
              { phase: "rest", hide: "display" },
              "session-working-label",
            )}
          >
            {word}
          </span>
        ) : null}
        {elapsed ? <span className="shrink-0 tabular-nums">{elapsed}</span> : null}
      </Text>
    </Tooltip>
  );
}
