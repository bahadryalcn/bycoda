import type { SocialCollection, SocialCollectionFilter, SocialSnapshot } from "./social";

const collectionFields: Partial<Record<SocialCollection, keyof SocialSnapshot>> = {
  campaigns: "campaigns",
  publishingPlans: "publishingPlans",
  threads: "threads",
  contacts: "contacts",
  rules: "rules",
  jobs: "jobs",
  drafts: "drafts",
};

/** Preserve the concrete row type selected by this collection key. */
function mergeRelatedRows<Key extends string, Row extends { id: string }>(
  field: Key,
  target: Partial<Record<NoInfer<Key>, Row[]>>,
  oldRows: Row[],
  newRows: Row[],
): void {
  if (oldRows.length || newRows.length)
    target[field] = [...new Map([...oldRows, ...newRows].map((row) => [row.id, row])).values()];
}

/** Merge one bounded offset page into rows already loaded for same query scope. */
export function appendSocialWorkspacePage(
  previous: SocialSnapshot | undefined,
  next: SocialSnapshot,
  offsets: Partial<Record<SocialCollection, number>> = {},
): SocialSnapshot {
  if (!previous) return next;
  const merged = { ...previous, ...next };
  if (previous.related || next.related) {
    const related = { ...previous.related, ...next.related };
    mergeRelatedRows(
      "campaigns",
      related,
      previous.related?.campaigns ?? [],
      next.related?.campaigns ?? [],
    );
    mergeRelatedRows(
      "contacts",
      related,
      previous.related?.contacts ?? [],
      next.related?.contacts ?? [],
    );
    mergeRelatedRows("jobs", related, previous.related?.jobs ?? [], next.related?.jobs ?? []);
    mergeRelatedRows(
      "threads",
      related,
      previous.related?.threads ?? [],
      next.related?.threads ?? [],
    );
    merged.related = related;
  }
  for (const [collection, field] of Object.entries(collectionFields) as [
    SocialCollection,
    keyof SocialSnapshot,
  ][]) {
    const offset = offsets[collection] ?? 0;
    const page = next.pages?.[collection];
    if (!field || offset <= 0 || !page || (field === "publishingPlans" && !next.publishingPlans))
      continue;
    const oldRows = previous[field];
    const newRows = next[field];
    if (!Array.isArray(oldRows) || !Array.isArray(newRows)) continue;
    const byId = new Map<string, (typeof newRows)[number]>();
    for (const row of [...oldRows, ...newRows] as { id: string }[])
      byId.set(row.id, row as (typeof newRows)[number]);
    (merged as Record<string, unknown>)[field] = [...byId.values()];
  }
  return merged;
}

export function hostSocialFilterMatches(
  snapshot: SocialSnapshot,
  collection: SocialCollection,
  expected: SocialCollectionFilter,
): boolean {
  if (!snapshot.pages) return false;
  const actual = snapshot.filters?.[collection] ?? {};
  return [...new Set([...Object.keys(actual), ...Object.keys(expected)])].every((key) => {
    const value = expected[key as keyof SocialCollectionFilter];
    return (
      (actual[key as keyof SocialCollectionFilter] ?? "") ===
      (typeof value === "string" ? value.trim() : (value ?? ""))
    );
  });
}

export function socialRows<T extends { id: string }>(rows: T[], related: T[] = []): T[] {
  return [...new Map([...related, ...rows].map((row) => [row.id, row])).values()];
}

export function scopeSocialSnapshot(
  snapshot: SocialSnapshot | null,
  projectId: string,
): SocialSnapshot | null {
  if (!snapshot) return snapshot;
  if (!projectId) return { ...snapshot, programProjectId: undefined };
  return {
    ...snapshot,
    programProjectId: projectId,
    campaigns: snapshot.campaigns.filter((item) => item.projectIds.includes(projectId)),
    threads: snapshot.threads.filter((item) => item.projectId === projectId || !item.projectId),
    contacts: snapshot.contacts.filter((item) => item.projectIds.includes(projectId)),
    rules: snapshot.rules.filter((item) => item.projectId === projectId),
    jobs: snapshot.jobs.filter((item) => item.projectIds.includes(projectId)),
    segments: snapshot.segments.filter((item) => item.projectIds.includes(projectId)),
    drafts: snapshot.drafts.filter((item) => item.projectId === projectId),
    publishingPlans: snapshot.publishingPlans?.filter((item) => item.projectId === projectId),
  };
}
