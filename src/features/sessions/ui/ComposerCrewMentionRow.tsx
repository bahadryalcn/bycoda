import { Code } from "../../../shared/ui/Code";
import { useT } from "../../../shared/i18n";
import { UsersRound } from "../../../shared/ui/icons";
import { MemberAvatar, memberTraits } from "../../crews/public/mentions";
import { CREWS_MENTION_SCOPE, type CrewMentionTarget } from "../model/crewMentions";

/** Portrait size in px; matches the picker's other leading icons. */
const ICON_PX = 20;

/** Leading portrait of a member or the crew mark in the same icon slot. */
export function CrewMentionIcon({ target }: { target: CrewMentionTarget }) {
  return target.kind === "member" ? (
    <MemberAvatar traits={memberTraits(target.agent)} size={ICON_PX} />
  ) : (
    <UsersRound className="icon-sm" />
  );
}

/** Member handle or crew size in the shared option's metadata slot. */
export function CrewMentionMeta({ target }: { target: CrewMentionTarget }) {
  const t = useT();
  if (target.kind === "member") {
    return (
      <Code size="micro" tone="secondary">
        @{CREWS_MENTION_SCOPE}
        {target.token}
      </Code>
    );
  }
  const count = target.definition.agents.length;
  return count === 1 ? t("1 member") : t("{p0} members", { p0: count });
}
