import type { SavedCrewAgent } from "./crew";
import { libraryGroups } from "./crewRoster";

/** Whether renaming `group` to `next` would land on another existing library group. */
export function groupNameTaken(
  agents: readonly SavedCrewAgent[],
  group: string,
  next: string,
): boolean {
  return next !== group && libraryGroups(agents).includes(next);
}

/**
 * Params of the atomic `crews.agent.group.update` call for `group` as `agents` shows it now:
 * the whole membership with each profile's revision, so the Host applies nothing when the
 * group changed elsewhere. Without `rename` the group is removed; the members are kept.
 */
export function groupUpdateParams(
  agents: readonly SavedCrewAgent[],
  group: string,
  rename?: string,
) {
  return {
    group,
    ...(rename === undefined ? {} : { rename }),
    members: agents
      .filter((agent) => agent.groups?.includes(group))
      .map((agent) => ({ agentId: agent.id, expectedUpdatedAt: agent.updatedAt })),
  };
}
