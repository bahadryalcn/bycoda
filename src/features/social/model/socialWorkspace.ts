import type { SocialCollection, SocialCollectionFilter, SocialSnapshot } from "./social";

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
