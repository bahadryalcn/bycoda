import { isDeepStrictEqual } from "node:util";
import type {
  CrewAgent,
  CrewCandidate,
  CrewDefinition,
  SavedCrewAgent,
} from "../../src/features/crews/model/crew";
import type { HostStore } from "../store";
import type { CrewDefaultsState } from "./crew-defaults";
import type { CrewState } from "./crew-ports";
import { readCrewDefinitions } from "./crew-scheduler-projection";

/**
 * One record per member: a crew member copied from the library keeps `source.id`
 * and follows that profile until the crew customizes it (`customized: true`).
 * Members stay full `CrewAgent` records so readers, runs and coordinator tools
 * never consult the library. Library and definitions share one state blob, so
 * every function here mutates that state inside the caller's transaction.
 * Run snapshots (`run.definition`) are never touched.
 */

/** A crew sees global library profiles and the profiles of its own project. */
const sees = (definition: CrewDefinition, agent: SavedCrewAgent) =>
  !agent.projectId || agent.projectId === definition.projectId;

/** Fields a library profile owns. Capability evidence is per saved copy, so it is ignored. */
const profile = (agent: CrewAgent) => ({
  name: agent.name,
  instructions: agent.instructions,
  selection: agent.selection,
  candidates: agent.candidates.map(({ capabilities: _capabilities, ...rest }) => rest),
  groups: agent.groups ?? [],
  avatar: agent.avatar ?? null,
  handle: agent.handle ?? null,
  tools: agent.tools ?? null,
  pool: agent.pool ?? null,
});
const matches = (member: CrewAgent, library: SavedCrewAgent) =>
  isDeepStrictEqual(profile(member), profile(library));

function followLibrary(member: CrewAgent, library: SavedCrewAgent): CrewAgent {
  const {
    groups: _groups,
    avatar: _avatar,
    handle: _handle,
    tools: _tools,
    pool: _pool,
    ...rest
  } = member;
  const evidence = new Map(member.candidates.map((c) => [c.id, c.capabilities]));
  const candidates = structuredClone(library.candidates).map((c): CrewCandidate => ({
    ...c,
    capabilities: evidence.get(c.id) ?? {},
  }));
  return {
    ...rest,
    name: library.name,
    instructions: library.instructions,
    selection: library.selection,
    candidates,
    ...(library.groups?.length ? { groups: [...library.groups] } : {}),
    ...(library.avatar ? { avatar: structuredClone(library.avatar) } : {}),
    ...(library.handle ? { handle: library.handle } : {}),
    ...(library.tools ? { tools: structuredClone(library.tools) } : {}),
    ...(library.pool ? { pool: { ...library.pool } } : {}),
    source: { id: library.id, updatedAt: library.updatedAt },
  };
}

/** Everything except the bookkeeping revision, so a pure revision refresh is not a content change. */
const content = (member: CrewAgent) => ({ ...member, source: member.source?.id });

function rewriteMembers(
  state: CrewDefaultsState,
  now: () => number,
  change: (member: CrewAgent, definition: CrewDefinition) => CrewAgent,
): void {
  state.definitions = state.definitions.map((definition) => {
    let touched = false;
    let bump = false;
    const agents = definition.agents.map((member) => {
      const next = change(member, definition);
      if (next === member) return member;
      touched = true;
      bump ||= !isDeepStrictEqual(content(member), content(next));
      return next;
    });
    if (!touched) return definition;
    return {
      ...definition,
      agents,
      ...(bump ? { updatedAt: Math.max(now(), definition.updatedAt + 1) } : {}),
    };
  });
}

/**
 * After `crews.agent.save`: linked, uncustomized members in crews that can see the
 * profile take its synced fields (not id, role or customized). A crew's revision
 * moves only when a member's content changed. Inert until the one-time migration ran,
 * so an unmigrated member the owner edited in a crew is never overwritten.
 */
export function syncLinkedMembers(state: CrewDefaultsState, agent: SavedCrewAgent): void {
  if (!state.membershipLinked) return;
  rewriteMembers(
    state,
    () => agent.updatedAt,
    (member, definition) => {
      if (member.source?.id !== agent.id || member.customized || !sees(definition, agent))
        return member;
      const next = followLibrary(member, agent);
      return isDeepStrictEqual(next, member) ? member : next;
    },
  );
}

/** Refuses a definition save the caller may not make or that races an edit; returns the stored version. */
export function checkSave(
  state: CrewDefaultsState,
  definition: CrewDefinition,
  expectedUpdatedAt: number | undefined,
  principal?: { projectId: string },
): CrewDefinition | undefined {
  const previous = state.definitions.find((d) => d.id === definition.id);
  // An editor holding a deleted crew must not silently recreate it.
  if (!previous && expectedUpdatedAt !== undefined) throw new Error("This crew was deleted");
  if (principal && definition.policy.delegateApprovals && !previous?.policy.delegateApprovals)
    throw new Error("Only the owner may grant delegated approvals");
  if (previous && principal && previous.projectId !== principal.projectId)
    throw new Error("Cannot modify a global or foreign crew");
  if (
    previous &&
    (previous.updatedAt !== expectedUpdatedAt || previous.projectId !== definition.projectId)
  )
    throw new Error("Crew changed. Reload before saving");
  return previous;
}

/** Owner delete of one library profile visible to `projectId`: removes it and detaches linked members. */
export function deleteLibraryAgent(
  state: CrewDefaultsState,
  agentId: string,
  projectId: string,
  now: () => number,
): SavedCrewAgent {
  const agent = state.agents?.find(
    (a) => a.id === agentId && (!a.projectId || a.projectId === projectId),
  );
  if (!agent) throw new Error("Unknown agent");
  state.agents = (state.agents ?? []).filter((a) => a !== agent);
  detachLinkedMembers(state, agent, now);
  return agent;
}

/** After `crews.agent.delete`: linked members keep their current copy and lose the link. */
export function detachLinkedMembers(
  state: CrewDefaultsState,
  agent: SavedCrewAgent,
  now: () => number,
) {
  rewriteMembers(state, now, (member, definition) => {
    if (member.source?.id !== agent.id || !sees(definition, agent)) return member;
    const { source: _source, ...rest } = member;
    return rest;
  });
}

/**
 * Prepares a definition about to be saved. Declared capabilities cannot mint runtime
 * tool access, so evidence resets to unknown. A linked member whose synced fields differ
 * from its library profile was edited inside this crew and becomes `customized`; one that
 * still equals the profile (including an explicit re-link without the flag) stays linked.
 */
export function prepareDefinitionMembers(state: CrewDefaultsState, definition: CrewDefinition) {
  for (const agent of definition.agents) {
    for (const candidate of agent.candidates)
      candidate.capabilities = Object.fromEntries(
        Object.entries(candidate.capabilities).map(([k, v]) => [
          k,
          { ...v, state: "unknown", source: "owner declaration; runtime verification required" },
        ]),
      );
    if (!agent.source || agent.customized) continue;
    const library = state.agents?.find((a) => a.id === agent.source!.id && sees(definition, a));
    if (library && !matches(agent, library)) agent.customized = true;
  }
}

/**
 * One-time, idempotent link normalization (marker `membershipLinked`): a member whose
 * source profile exists and equals it stays linked, one that differs becomes
 * `customized`, and one whose profile is gone loses its dangling source.
 * Returns whether the state changed.
 */
export function migrateLinkedMembers(state: CrewDefaultsState, now: () => number): boolean {
  if (state.membershipLinked) return false;
  rewriteMembers(state, now, (member, definition) => {
    if (!member.source) return member;
    const sourceId = member.source.id;
    const library = state.agents?.find((a) => a.id === sourceId && sees(definition, a));
    if (!library) {
      const { source: _source, ...rest } = member;
      return rest;
    }
    return member.customized || matches(member, library) ? member : { ...member, customized: true };
  });
  state.membershipLinked = true;
  return true;
}

/** Runs the migration once per store, in its own transaction, before defaults initialize. */
export async function linkMembership(
  store: HostStore,
  read: () => Promise<CrewState>,
  write: (state: CrewState) => Promise<void>,
  now: () => number,
): Promise<void> {
  if ((await readCrewDefinitions(store)).membershipLinked) return;
  await store.transaction(async () => {
    const state = await read();
    if (migrateLinkedMembers(state, now)) await write(state);
  });
}
