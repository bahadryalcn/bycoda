import type { SessionSummary } from "../data/sessionStore";

export function compareSessionSummaries(a: SessionSummary, b: SessionSummary): number {
  const pin = Number(!!b.pinned) - Number(!!a.pinned);
  if (pin !== 0) return pin;
  return (
    (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}
