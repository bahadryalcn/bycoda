import type { SavedCrewAgent } from "../../src/features/crews/model/crew";
import type { CrewDefaultsState } from "./crew-defaults";
import { syncLinkedMembers } from "./crew-membership";

export type LibraryGroupUpdate = {
  projectId: string;
  group: string;
  /** The new label; `undefined` removes `group` from its members. */
  rename?: string | undefined;
  members: ReadonlyArray<{ agentId: string; expectedUpdatedAt: number }>;
};

/**
 * Renames or removes one library group on every profile that carries it, inside the
 * caller's transaction. Groups are labels on each profile, so the whole group moves or
 * nothing does: a changed membership, a stale profile revision or an existing target
 * name throws before any profile is touched. Each moved profile gets the same revision
 * bump and linked-member sync as `crews.agent.save`. Returns the number of profiles moved.
 */
export function updateLibraryGroup(
  state: CrewDefaultsState,
  update: LibraryGroupUpdate,
  now: () => number,
): number {
  const { projectId, group, rename } = update;
  if (rename === group) return 0;
  const target = rename?.trim();
  if (rename !== undefined && (!target || target.length > 40)) throw new Error("Invalid group name");
  const visible = (state.agents ?? []).filter((a) => !a.projectId || a.projectId === projectId);
  const current = visible.filter((a) => a.groups?.includes(group));
  const expected = new Map(update.members.map((m) => [m.agentId, m.expectedUpdatedAt]));
  if (
    !current.length ||
    expected.size !== update.members.length ||
    expected.size !== current.length ||
    current.some((a) => expected.get(a.id) !== a.updatedAt)
  )
    throw new Error("Group changed. Reload before saving");
  if (target && visible.some((a) => a.groups?.includes(target)))
    throw new Error(`A group named ${target} already exists`);
  const moved = new Map<string, SavedCrewAgent>();
  for (const agent of current) {
    const { groups: previous = [], ...rest } = agent;
    const groups = previous.flatMap((item) => (item !== group ? [item] : target ? [target] : []));
    moved.set(agent.id, {
      ...rest,
      ...(groups.length ? { groups } : {}),
      updatedAt: Math.max(now(), agent.updatedAt + 1),
    });
  }
  state.agents = (state.agents ?? []).map((a) => moved.get(a.id) ?? a);
  for (const agent of moved.values()) syncLinkedMembers(state, agent);
  return moved.size;
}
