import { t } from "../../../shared/i18n/core";
import {
  parseCrewDefinition,
  type CrewAgent,
  type CrewDefinition,
  type SavedCrewAgent,
} from "./crew";
import { memberFromLibrary } from "./crewRoster";

const MAX_MEMBERS = 20;

export type AssignmentSkip = { name: string; reason: string };
export type AssignmentPlan =
  | { ok: true; definition: CrewDefinition }
  | { ok: false; reason: string };
export type BulkAssignmentPlan = {
  /** The definition to save; absent when nothing could be added. */
  definition?: CrewDefinition;
  added: string[];
  skipped: AssignmentSkip[];
};

/** Why the Host would reject a definition, or undefined when its rules pass. */
function definitionProblem(definition: CrewDefinition): string | undefined {
  try {
    parseCrewDefinition(structuredClone(definition));
    return undefined;
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason);
  }
}

function linked(definition: CrewDefinition, libraryId: string): CrewAgent[] {
  return definition.agents.filter((agent) => agent.source?.id === libraryId);
}

function checked(next: CrewDefinition): AssignmentPlan {
  const problem = definitionProblem(next);
  return problem ? { ok: false, reason: problem } : { ok: true, definition: next };
}

/** Adds a team copy of a library profile in the profile's own role, or says why it cannot. */
export function planAdd(definition: CrewDefinition, profile: SavedCrewAgent): AssignmentPlan {
  const team = definition.name;
  if (linked(definition, profile.id).length)
    return { ok: false, reason: t("Already in {p0}", { p0: team }) };
  if (definition.agents.length >= MAX_MEMBERS)
    return {
      ok: false,
      reason: t("{p0} already has {p1} members, the most a team can have", {
        p0: team,
        p1: MAX_MEMBERS,
      }),
    };
  if (profile.role === "coordinator" && definition.agents.some((a) => a.role === "coordinator"))
    return { ok: false, reason: t("{p0} already has a coordinator", { p0: team }) };
  if (profile.role === "reviewer" && definition.agents.some((a) => a.role === "reviewer"))
    return { ok: false, reason: t("{p0} already has a reviewer", { p0: team }) };
  if (profile.handle && definition.agents.some((a) => a.handle === profile.handle))
    return {
      ok: false,
      reason: t("{p0} already has a member with the handle @{p1}", {
        p0: team,
        p1: profile.handle,
      }),
    };
  return checked({ ...definition, agents: [...definition.agents, memberFromLibrary(profile)] });
}

/** Removes every team copy linked to a library profile, unless that would leave an invalid team. */
export function planRemove(definition: CrewDefinition, profile: SavedCrewAgent): AssignmentPlan {
  const team = definition.name;
  const copies = linked(definition, profile.id);
  if (!copies.length) return { ok: false, reason: t("Not in {p0}", { p0: team }) };
  if (copies.some((a) => a.role === "coordinator"))
    return {
      ok: false,
      reason: t("{p0} is the coordinator of {p1}; choose another coordinator first", {
        p0: profile.name,
        p1: team,
      }),
    };
  if (copies.some((a) => a.role === "reviewer"))
    return {
      ok: false,
      reason: t("{p0} is the reviewer of {p1}; choose another reviewer first", {
        p0: profile.name,
        p1: team,
      }),
    };
  const ids = new Set(copies.map((a) => a.id));
  const agents = definition.agents.filter((a) => !ids.has(a.id));
  if (!agents.some((a) => a.role === "specialist"))
    return {
      ok: false,
      reason: t("{p0} is the last specialist of {p1}", { p0: profile.name, p1: team }),
    };
  return checked({ ...definition, agents });
}

/** Adds every profile that fits, in order, so one save covers them; the rest are reported with reasons. */
export function planBulkAdd(
  definition: CrewDefinition,
  profiles: readonly SavedCrewAgent[],
): BulkAssignmentPlan {
  let current = definition;
  const added: string[] = [];
  const skipped: AssignmentSkip[] = [];
  for (const profile of profiles) {
    const plan = planAdd(current, profile);
    if (plan.ok) {
      current = plan.definition;
      added.push(profile.name);
    } else skipped.push({ name: profile.name, reason: plan.reason });
  }
  return { definition: added.length ? current : undefined, added, skipped };
}
