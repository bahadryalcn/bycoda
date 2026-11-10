import { useT } from "../../../shared/i18n";
import { MatchText } from "../../../shared/ui/MatchText";
import { CrewFaces, MemberAvatar, memberTraits, type CrewRole } from "../../crews/public/mentions";
import type { CrewMentionTarget } from "../model/crewMentions";

/** Portrait size in px; matches the picker's other leading icons. */
const ICON_PX = 20;

function useRoleLabel() {
  const t = useT();
  return (role: CrewRole) =>
    role === "coordinator"
      ? t("Coordinator")
      : role === "reviewer"
        ? t("Reviewer")
        : role === "advisor"
          ? t("Advisor")
          : t("Specialist");
}

/** Leading portrait of a member or the overlapping faces of a crew. */
export function CrewMentionIcon({ target }: { target: CrewMentionTarget }) {
  return target.kind === "member" ? (
    <MemberAvatar traits={memberTraits(target.agent)} size={ICON_PX} />
  ) : (
    <CrewFaces members={target.definition.agents} size={ICON_PX} max={3} label={target.name} />
  );
}

/** Name, `@handle` and role (members) or member count (crews) of one mention row. */
export function CrewMentionText({
  target,
  positions,
  query,
}: {
  target: CrewMentionTarget;
  positions: number[];
  query: string;
}) {
  const t = useT();
  const roleLabel = useRoleLabel();
  const count = target.kind === "crew" ? target.definition.agents.length : 0;
  const detail =
    target.kind === "member"
      ? roleLabel(target.agent.role)
      : count === 1
        ? t("1 member")
        : t("{p0} members", { p0: count });
  return (
    <>
      <span className="min-w-0 flex-1 truncate">
        <MatchText text={target.name} positions={positions} active={Boolean(query.trim())} />
        <span className="ps-1.5 font-mono text-ui-micro text-(--ui-text-secondary)">
          @{target.token}
        </span>
      </span>
      <span className="shrink-0 text-ui-micro text-(--ui-text-secondary)">{detail}</span>
    </>
  );
}
