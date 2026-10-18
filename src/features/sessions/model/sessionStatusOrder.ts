import type { SessionSummary } from "../data/sessionStore";

/** Actionable status leads; reading a finished session never changes its rank. */
export function sessionStatusOrder(
  inputIds: ReadonlySet<string>,
  workingIds: ReadonlySet<string>,
): (a: SessionSummary, b: SessionSummary) => number {
  const rank = (session: SessionSummary): number => {
    if (inputIds.has(session.id)) return 0;
    if (session.issue === "failed") return 1;
    if (workingIds.has(session.id) || session.issue === "retrying") return 2;
    return 3;
  };
  return (a, b) => rank(a) - rank(b);
}
