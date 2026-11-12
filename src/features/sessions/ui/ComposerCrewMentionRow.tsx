import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
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
      <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
        <MatchText text={target.name} positions={positions} active={Boolean(query.trim())} />
        <Code size="micro" tone="secondary" className="ps-1.5">
          @{target.token}
        </Code>
      </Text>
      <Text size="micro" tone="secondary" className="shrink-0">
        {detail}
      </Text>
    </>
  );
}
