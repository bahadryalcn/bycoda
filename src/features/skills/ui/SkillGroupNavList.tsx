import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { skillGroupInvocation, type SkillGroup } from "../index";

/**
 * The library pane in Groups view: one row per group (name, command, size). Selecting a row
 * opens its membership editor; the query matches a group name, command or member name.
 * `action` is the one "Group with AI" entry; creating a group by hand lives in the toolbar.
 */
export function SkillGroupNavList({
  groups,
  query,
  selectedId,
  onSelect,
  action,
}: {
  groups: SkillGroup[];
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  action?: ReactNode;
}) {
  useLocale();
  const needle = query.trim().toLocaleLowerCase();
  const shown = groups.filter(
    (group) =>
      !needle ||
      group.name.toLocaleLowerCase().includes(needle) ||
      skillGroupInvocation(group).includes(needle) ||
      group.skillNames.some((name) => name.toLocaleLowerCase().includes(needle)),
  );
  if (!groups.length)
    return (
      <>
        <EmptyState size="inline" description={t("No groups")} />
        {action ? <div className="px-2">{action}</div> : null}
      </>
    );
  return (
    <>
      {action ? <div className="px-2 pb-2">{action}</div> : null}
      <ul aria-label={t("Skill groups")} className="m-0 list-none p-0">
        {shown.map((group) => (
          <CollectionRow
            as="li"
            key={group.id}
            selected={group.id === selectedId}
            title={group.name}
            secondary={`/${skillGroupInvocation(group)}`}
            trailing={String(group.skillNames.length)}
            onOpen={() => onSelect(group.id)}
            primary={{ "aria-current": group.id === selectedId ? "true" : undefined }}
          />
        ))}
      </ul>
      {needle && !shown.length ? (
        <EmptyState size="inline" description={t("No matching groups")} />
      ) : null}
    </>
  );
}
