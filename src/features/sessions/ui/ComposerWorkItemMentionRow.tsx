import { MatchText } from "../../../shared/ui/MatchText";
import { Text } from "../../../shared/ui/Text";
import { WORK_ITEM_PROVIDER_NAMES, type WorkItemMentionTarget } from "../model/workItemMentionRows";

/** Provider name and aliases, or identifier and title, within the shared picker row. */
export function WorkItemMentionText({
  target,
  name,
  positions,
}: {
  target: WorkItemMentionTarget;
  name: string;
  positions: number[];
}) {
  return target.kind === "hint" ? (
    <Text size="inherit" tone="inherit" truncate>
      {WORK_ITEM_PROVIDER_NAMES[target.provider]} —{" "}
      {target.aliases.map((alias) => `${alias}:`).join(" · ")}
    </Text>
  ) : (
    <MatchText text={name} positions={positions} active={positions.length > 0} />
  );
}

export function workItemMentionMeta(
  target: WorkItemMentionTarget,
  unassigned: string,
): string | undefined {
  if (target.kind === "hint") return undefined;
  const item = target.item;
  const assignee =
    item.assignees
      .map((person) => person.login)
      .filter(Boolean)
      .join(", ") || unassigned;
  return [assignee, item.state, item.repo || item.teamName || item.projectName]
    .filter(Boolean)
    .join(" · ");
}
