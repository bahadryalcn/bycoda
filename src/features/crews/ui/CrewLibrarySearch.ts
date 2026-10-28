/**
 * Search over the member library and the Add members picker (CR-E06). The matcher
 * is pure: callers pass the same labels their rows render, so a query finds what the
 * row shows (name, role, model summary and candidate models, groups) and the
 * profile's instructions. Scope is not searched: its two fixed labels share words
 * ("this", "project"), so a term would match every row. It carries no i18n or
 * catalog dependency.
 */

export type MemberSearchSubject = {
  name: string;
  instructions: string;
  groups?: readonly string[];
};

/** The visible row text for one member, already localized by the caller. */
export type MemberSearchLabels = {
  /** The role label, e.g. "Reviewer". */
  role: string;
  /** The model summary line, e.g. "Fixed: GPT-5" or "Automatic: 3 candidates". */
  model: string;
  /** Every candidate's model name or id, so an automatic pool is searchable by model. */
  candidates: readonly string[];
};

export function memberSearchHaystack(
  agent: MemberSearchSubject,
  labels: MemberSearchLabels,
): string {
  return [
    agent.name,
    labels.role,
    labels.model,
    ...labels.candidates,
    ...(agent.groups ?? []),
    agent.instructions,
  ]
    .join("\n")
    .toLocaleLowerCase();
}

/** Every whitespace-separated term must appear somewhere in the haystack. */
export function matchesMemberQuery(haystack: string, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

/**
 * Group filter, then query, then name order. The group filter is exact, and an empty
 * query or group keeps every member, so project and global profiles are never split here.
 */
export function filterLibraryMembers<T extends MemberSearchSubject>(
  agents: readonly T[],
  options: { query: string; group: string; labels: (agent: T) => MemberSearchLabels },
): T[] {
  const { query, group, labels } = options;
  return agents
    .filter((agent) => !group || agent.groups?.includes(group))
    .filter((agent) => matchesMemberQuery(memberSearchHaystack(agent, labels(agent)), query))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Picked ids that the current query or group hides; they stay picked. */
export function hiddenSelection(
  selected: readonly string[],
  visible: readonly { id: string }[],
): string[] {
  const shown = new Set(visible.map((agent) => agent.id));
  return selected.filter((id) => !shown.has(id));
}
