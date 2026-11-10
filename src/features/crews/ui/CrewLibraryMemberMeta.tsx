import { t } from "../../../shared/i18n";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { SavedCrewAgent } from "../model/crew";
import { candidateLabel, memberModelSummary } from "../model/crewRoster";
import { filterLibraryMembers, type MemberSearchLabels } from "./CrewLibrarySearch";
import { memberTraits } from "../model/memberAvatars";
import { CrewRoleIcon } from "./CrewRoleIcon";
import { MemberAvatar } from "./MemberAvatar";
import { roleLabel } from "./CrewMemberForm";
import { crewToolPresetLabel } from "./MemberToolsPicker";

/** Library profile scope, the same wording in the library list and the picker. */
export function memberScopeLabel(agent: Pick<SavedCrewAgent, "projectId">, short = false) {
  return agent.projectId
    ? t("This project")
    : short
      ? t("All projects")
      : t("All projects on this host");
}

/** The labels a library row renders, so search matches exactly what the row shows (CR-E06). */
export function libraryMemberSearchLabels(
  catalog: HostModelCatalog,
  agent: SavedCrewAgent,
): MemberSearchLabels {
  return {
    role: roleLabel(agent.role),
    model: memberModelSummary(catalog, agent),
    candidates: agent.candidates.flatMap((candidate) => [
      candidateLabel(catalog, candidate),
      candidate.model,
      candidate.harness,
    ]),
  };
}

/** Library members that pass the group filter and the query, in name order. */
export function visibleLibraryMembers(
  agents: readonly SavedCrewAgent[],
  catalog: HostModelCatalog,
  query: string,
  group: string,
): SavedCrewAgent[] {
  return filterLibraryMembers(agents, {
    query,
    group,
    labels: (agent) => libraryMemberSearchLabels(catalog, agent),
  });
}

/** A library member's face and name, with its `@handle` as a quiet caption when it has one. */
export function CrewMemberIdentity({ agent }: { agent: SavedCrewAgent }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <MemberAvatar traits={memberTraits(agent)} size={20} className="shrink-0" />
      <span className="min-w-0 truncate">{agent.name}</span>
      {agent.handle ? (
        <span className="shrink-0 text-ui-caption font-normal text-(--ui-text-secondary)">
          @{agent.handle}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Identity line of a library member row: structural role cue and label, model
 * summary, scope. The role glyph is never a provider or crew mascot cue.
 */
export function CrewMemberMeta({
  agent,
  catalog,
  shortScope = false,
  poolName,
}: {
  agent: SavedCrewAgent;
  catalog: HostModelCatalog;
  shortScope?: boolean;
  /** The name of the model pool the member follows, when known. */
  poolName?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-ui-caption font-normal text-(--ui-text-secondary)">
      <span className="flex shrink-0 items-center gap-1">
        <CrewRoleIcon role={agent.role} />
        {roleLabel(agent.role)}
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">
        {[
          poolName && agent.pool
            ? t("Automatic: {p0}", { p0: poolName })
            : memberModelSummary(catalog, agent),
          memberScopeLabel(agent, shortScope),
          ...(agent.tools ? [crewToolPresetLabel(agent.tools.preset)] : []),
        ].join(" · ")}
      </span>
    </span>
  );
}
