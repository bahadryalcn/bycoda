import { HARNESSES, HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import type { sessionUsage } from "./usageAnalytics";

/**
 * Session titles are stored as "<harness> · <title>". The icon already names the provider, so the
 * prefix is removed from the label. The prefix comes from the session's own harness, while the row
 * provider is the first recorded turn's harness, so a known prefix also decides the provider.
 */
export function splitSessionTitle(
  title: string,
  provider: string,
): { label: string; provider: string } {
  const separator = title.indexOf(" · ");
  if (separator <= 0) return { label: title, provider };
  const prefix = title.slice(0, separator).trim().toLowerCase();
  const harness = HARNESSES.find(
    (id) => id === prefix || HARNESS_TITLE[id].toLowerCase() === prefix,
  );
  if (!harness) return { label: title, provider };
  const label = title.slice(separator + 3).trim();
  return { label: label || title, provider: harness };
}

/** Preserve missing measurements as unavailable in the continuous session table. */
export function recordedSessionRows(rows: ReturnType<typeof sessionUsage>) {
  return rows.map((row) => {
    const { label, provider } = splitSessionTitle(row.title || row.key, row.provider);
    return {
      ...row,
      provider,
      label,
      duration: row.timedTurns ? row.duration : null,
      cost: row.meteredTurns > row.unpricedTurns ? row.cost : null,
      tokens: row.meteredTurns ? row.tokens : null,
      input: row.meteredTurns ? row.input : null,
      output: row.meteredTurns ? row.output : null,
      cacheRead: row.meteredTurns ? row.cacheRead : null,
      cacheWrite: row.meteredTurns ? row.cacheWrite : null,
    };
  });
}
