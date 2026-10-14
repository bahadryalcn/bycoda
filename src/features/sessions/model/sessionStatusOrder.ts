import type { SessionSummary } from "../data/sessionStore";

/** Status takes precedence over the saved order within each sidebar group. */
export function sessionStatusOrder(
  inputIds: ReadonlySet<string>,
  workingIds: ReadonlySet<string>,
  doneIds: ReadonlySet<string>,
): (a: SessionSummary, b: SessionSummary) => number {
  const rank = (session: SessionSummary): number => {
    if (inputIds.has(session.id)) return 0;
    if (session.issue === "failed") return 1;
    if (workingIds.has(session.id) || session.issue === "retrying") return 2;
    if (doneIds.has(session.id)) return 3;
    return 4;
  };
  return (a, b) => rank(a) - rank(b);
}
