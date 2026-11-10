import type { CrewAgent, CrewDefinition, SavedCrewAgent } from "./crew";

export type MemberLink = "linked" | "customized";

/** Fields a library profile owns; everything else on a member belongs to the crew. */
const SYNCED = [
  "name",
  "instructions",
  "selection",
  "candidates",
  "groups",
  "avatar",
  "handle",
] as const;

/** The member's link to its library profile; none for a crew-only member or a profile this crew cannot see. */
export function memberLink(
  member: CrewAgent,
  library: readonly SavedCrewAgent[],
): { state: MemberLink; profile: SavedCrewAgent } | undefined {
  const profile = member.source && library.find((saved) => saved.id === member.source!.id);
  if (!profile) return undefined;
  return { state: member.customized ? "customized" : "linked", profile };
}

/** A patch that takes every synced field from the library profile and drops `customized`. */
export function libraryVersionPatch(profile: SavedCrewAgent): Partial<CrewAgent> {
  const copy = structuredClone(profile);
  return {
    name: copy.name,
    instructions: copy.instructions,
    selection: copy.selection,
    candidates: copy.candidates,
    groups: copy.groups,
    avatar: copy.avatar,
    handle: copy.handle,
    source: { id: profile.id, updatedAt: profile.updatedAt },
    customized: undefined,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A member without the fields a library sync rewrites and without its link revision. */
const unsynced = (member: CrewAgent) => {
  const rest: Record<string, unknown> = { ...member };
  for (const key of SYNCED) delete rest[key];
  delete rest.source;
  return rest;
};

/**
 * Rebases an edited draft onto a newer stored crew when the only remote change is a
 * library sync: linked, uncustomized members got new synced fields and the draft did not
 * touch those members. Returns the draft carrying the latest revision, or undefined when
 * the change is a real conflict. `base` is the stored crew the draft was edited from.
 */
export function rebaseOntoSync(
  base: CrewDefinition,
  draft: CrewDefinition,
  latest: CrewDefinition,
): CrewDefinition | undefined {
  if (base.id !== draft.id || latest.id !== draft.id) return undefined;
  if (base.updatedAt !== draft.updatedAt || latest.updatedAt <= base.updatedAt) return undefined;
  const strip = (crew: CrewDefinition) => ({ ...crew, agents: undefined, updatedAt: 0 });
  if (!same(strip(base), strip(latest))) return undefined;
  if (base.agents.length !== latest.agents.length) return undefined;
  const synced = new Map<string, CrewAgent>();
  for (const [index, before] of base.agents.entries()) {
    const after = latest.agents[index];
    if (after.id !== before.id) return undefined;
    if (same(before, after)) continue;
    const linked = !!before.source && !before.customized;
    if (!linked || after.source?.id !== before.source!.id || after.customized) return undefined;
    if (!same(unsynced(before), unsynced(after))) return undefined;
    const current = draft.agents.find((agent) => agent.id === before.id);
    if (!current || !same(current, before)) return undefined;
    synced.set(before.id, after);
  }
  return {
    ...draft,
    agents: draft.agents.map((agent) => synced.get(agent.id) ?? agent),
    updatedAt: latest.updatedAt,
  };
}

/**
 * Maps a Host handle refusal to the member whose handle field should show it: the
 * member holding the named handle, or every member sharing a handle for a duplicate.
 */
export function handleErrorsFromHost(
  message: string,
  agents: readonly CrewAgent[],
): Record<string, string> {
  const taken = /^Handle @([^\s]+) is already used by/.exec(message);
  const duplicate = /Duplicate member handles/i.test(message);
  if (!taken && !duplicate) return {};
  const counts = new Map<string, number>();
  for (const agent of agents)
    if (agent.handle) counts.set(agent.handle, (counts.get(agent.handle) ?? 0) + 1);
  const result: Record<string, string> = {};
  for (const agent of agents) {
    if (!agent.handle) continue;
    if (taken ? agent.handle === taken[1] : (counts.get(agent.handle) ?? 0) > 1)
      result[agent.id] = message;
  }
  return result;
}
