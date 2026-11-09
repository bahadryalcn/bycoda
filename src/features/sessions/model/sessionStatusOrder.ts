import type { SessionSummary } from "../data/sessionStore";

/** Failures, interruptions and drafts older than this keep their recency place, so forgotten rows do not crowd the top. */
const ACTION_LIFT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Actionable status leads: input, then failed or interrupted, then unseen finished,
 * then working, then waiting (yielded, background work still running), then drafts. Equal ranks keep the caller's (recency) order.
 */
export function sessionStatusOrder(
  inputIds: ReadonlySet<string>,
  workingIds: ReadonlySet<string>,
  {
    doneIds,
    draftIds,
    waitingIds,
    now,
  }: {
    doneIds?: ReadonlySet<string>;
    draftIds?: ReadonlySet<string>;
    waitingIds?: ReadonlySet<string>;
    now?: number;
  } = {},
): (a: SessionSummary, b: SessionSummary) => number {
  const recent = (session: SessionSummary) =>
    now === undefined ||
    (session.lastActivityAt ?? session.updatedAt) >= now - ACTION_LIFT_WINDOW_MS;
  const rank = (session: SessionSummary): number => {
    const working = workingIds.has(session.id);
    if (inputIds.has(session.id)) return 0;
    if ((session.issue === "failed" || (session.interrupted && !working)) && recent(session))
      return 1;
    if (doneIds?.has(session.id)) return 2;
    if (working || session.issue === "retrying") return 3;
    if (waitingIds?.has(session.id)) return 3.5;
    if ((session.draft || draftIds?.has(session.id)) && recent(session)) return 4;
    return 5;
  };
  return (a, b) => rank(a) - rank(b);
}
