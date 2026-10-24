import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  parseCrewDefinition,
  type CrewAgent,
  type CrewDefinition,
  type SavedCrewAgent,
} from "../src/features/crews/model/crew";
import {
  createDefaultCrew,
  DEFAULT_CREW_ID,
  DEFAULT_CREW_REVISION,
} from "../src/features/crews/model/crewDefaults";

export type CrewDefaultsState = {
  definitions: CrewDefinition[];
  agents?: SavedCrewAgent[];
  defaultsInitialized?: boolean;
  defaultsRevision?: number;
  defaultInstructionHashes?: Record<string, string>;
};

/** Immutable fingerprints of the original seed, before revision tracking existed. */
export const LEGACY_DEFAULT_INSTRUCTION_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "bycoda.role.team-lead": "e969684ff95a98a874fa748856b9e0ff8c0ef24df20f922f977f76eee5fbfb2f",
  "bycoda.role.project-manager": "b88bdc5734118bb7c28f3a5da6e655181be5be9c3c09a99c6fc6530cac2d7d16",
  "bycoda.role.product-manager": "e4f1441a4f6954c7851433374a0082e6a9226d64c9086ee91769d4e8924c4b38",
  "bycoda.role.ux-researcher": "3d1a8992c81bcc3bd432ef9bfef5ee6b057b06318bee3b124d28dfa7c92a9c1f",
  "bycoda.role.ux-designer": "20f171cd4c407db4c6a7b98833892583800444973f92163c5d509e58df10a888",
  "bycoda.role.designer": "9dd417e0b1d73883c687a89e3a2c591896b9e8c9178f8fb5753c1542f697ece2",
  "bycoda.role.ui-engineer": "acee32de7ac366041c01bef5996daf4005197de5f0f1a3aecce62d35abe565b2",
  "bycoda.role.mobile-engineer": "d5e5eb8e7d21cc53d1c047d0c089b7213c751be5445bd8b54f89a7627eeaf074",
  "bycoda.role.backend-engineer":
    "7b997a643edcaadb131738adf54bb60428e165e34c37ca398ee3a3f9f1b26219",
  "bycoda.role.architect": "4a6975d1e45e2608971c0d47a5ecdb0d27343c081fc4b5e3db7cd6a92d283c75",
  "bycoda.role.devops-engineer": "81212725ee080d846870d4ee5f6ab8e41ad64dade10ee71e3c3987ae8fe2d768",
  "bycoda.role.tester": "79a9fb552def6a0c95875bb98a3d805ecb92406e4eacd8103f7700acab2c6874",
  "bycoda.role.security-engineer":
    "c76fb5d216836c44339258e5a579fabfc02ab922bd5225dbb78470c8807546bf",
  "bycoda.role.accessibility-specialist":
    "97a0c1701d70f1f7fb6b71408018b86f49f6beb9272568a13298eeaff96e9914",
  "bycoda.role.reviewer": "1bd1895bd98cdbec589dc73c12340702ade633ce38fdcd14cfce704de4a9970a",
});

const instructionHash = (instructions: string) =>
  createHash("sha256").update(instructions).digest("hex");
const nextTimestamp = (previous: number, now: number) => Math.max(now, previous + 1);

export function crewDefaultsCurrent(state: CrewDefaultsState): boolean {
  return (
    state.defaultsInitialized === true && (state.defaultsRevision ?? 0) >= DEFAULT_CREW_REVISION
  );
}

/**
 * Called with freshly read state inside the host's transaction. The marker and
 * contents must be persisted together; this never mutates custom crews or runs.
 */
export function applyCrewDefaults<T extends CrewDefaultsState>(
  state: T,
  seed: NonNullable<ReturnType<typeof createDefaultCrew>>,
  now: number,
): T {
  if (crewDefaultsCurrent(state)) return state;
  const previousHashes = state.defaultInstructionHashes ?? LEGACY_DEFAULT_INSTRUCTION_HASHES;
  const templates = new Map(seed.agents.map((agent) => [agent.id, agent]));
  const previousLibrary = new Map((state.agents ?? []).map((agent) => [agent.id, agent]));
  const hashes = Object.fromEntries(
    seed.agents.map((agent) => [agent.id, instructionHash(agent.instructions)]),
  );
  const initial = state.defaultsInitialized !== true;
  const addedIds = new Set(
    seed.agents
      .filter((agent) => !Object.hasOwn(previousHashes, agent.id))
      .map((agent) => agent.id),
  );

  const agents = (state.agents ?? []).map((agent) => {
    const template = templates.get(agent.id);
    if (
      initial ||
      agent.projectId !== undefined ||
      !template ||
      instructionHash(agent.instructions) !== previousHashes[agent.id] ||
      agent.instructions === template.instructions
    )
      return agent;
    return {
      ...agent,
      instructions: template.instructions,
      updatedAt: nextTimestamp(agent.updatedAt, now),
    };
  });
  for (const template of seed.agents) {
    if ((initial || addedIds.has(template.id)) && !previousLibrary.has(template.id))
      agents.push({ ...structuredClone(template), updatedAt: now });
  }
  const library = new Map(agents.map((agent) => [agent.id, agent]));

  // A newly copied member may acknowledge only the actual matching profile.
  // A reserved-ID collision must not fabricate provenance for owner content.
  const newMember = (member: CrewAgent): CrewAgent => {
    const copy = structuredClone(member);
    const saved = library.get(member.id);
    if (saved && saved.projectId === undefined) {
      const { projectId: _projectId, updatedAt, ...profile } = saved;
      const { source: _source, ...memberProfile } = copy;
      if (isDeepStrictEqual(profile, memberProfile)) {
        copy.source = { id: saved.id, updatedAt };
        return copy;
      }
    }
    delete copy.source;
    return copy;
  };

  const definitions = state.definitions.map((definition) => {
    if (initial || definition.id !== DEFAULT_CREW_ID) return definition;
    let changed = false;
    let members = definition.agents.map((member) => {
      const template = templates.get(member.id);
      if (!template) return member;
      let updated = member;
      if (
        instructionHash(member.instructions) === previousHashes[member.id] &&
        member.instructions !== template.instructions
      )
        updated = { ...member, instructions: template.instructions };
      const saved = library.get(member.id);
      const previous = previousLibrary.get(member.id);
      if (
        updated.source?.id === member.id &&
        saved &&
        previous &&
        (definition.projectId !== undefined || saved.projectId === undefined) &&
        updated.instructions === template.instructions &&
        saved.instructions === template.instructions &&
        updated.source.updatedAt === previous.updatedAt &&
        updated.source.updatedAt !== saved.updatedAt
      )
        updated = { ...updated, source: { ...updated.source, updatedAt: saved.updatedAt } };
      changed ||= updated !== member;
      return updated;
    });

    const priorIds = Object.keys(previousHashes);
    const priorRosterIntact =
      definition.agents.length === priorIds.length &&
      new Set(definition.agents.map((member) => member.id)).size === priorIds.length &&
      definition.agents.every(
        (member) =>
          Object.hasOwn(previousHashes, member.id) &&
          templates.get(member.id)?.role === member.role,
      );
    const additions = seed.definition.agents
      .filter((member) => addedIds.has(member.id))
      .map(newMember);
    if (priorRosterIntact && additions.length && members.length + additions.length <= 20) {
      const expanded = [...members, ...additions];
      try {
        parseCrewDefinition({ ...definition, agents: expanded });
        members = expanded;
        changed = true;
      } catch {
        // Keep an owner-managed or legacy-invalid roster intact. New profiles
        // remain in the library and can be added explicitly through the editor.
      }
    }
    return changed
      ? { ...definition, agents: members, updatedAt: nextTimestamp(definition.updatedAt, now) }
      : definition;
  });
  if (initial && !definitions.some((definition) => definition.id === DEFAULT_CREW_ID))
    definitions.push({
      ...structuredClone(seed.definition),
      agents: seed.definition.agents.map(newMember),
      updatedAt: now,
    });

  return {
    ...state,
    agents,
    definitions,
    defaultsInitialized: true,
    defaultsRevision: DEFAULT_CREW_REVISION,
    defaultInstructionHashes: hashes,
  };
}
