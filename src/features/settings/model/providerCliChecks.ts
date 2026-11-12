import type { HarnessVersionCheck } from "../../providers/public/ProviderStatusGroup";
/** A fresh global snapshot supersedes earlier row checks. */
export function mergeProviderCliChecks(
  shared: HarnessVersionCheck[] | null,
  rows: { source: HarnessVersionCheck[] | null; check: HarnessVersionCheck }[],
): HarnessVersionCheck[] | null {
  const current = rows.filter((row) => row.source === shared);
  if (shared === null && current.length === 0) return null;
  const merged = new Map((shared ?? []).map((check) => [check.harness, check]));
  for (const row of current) merged.set(row.check.harness, row.check);
  return [...merged.values()];
}

export type { HarnessVersionCheck } from "../../providers/public/ProviderStatusGroup";
