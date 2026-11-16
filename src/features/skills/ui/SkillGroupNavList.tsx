import { t, useLocale } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { skillGroupInvocation, type SkillGroup } from "../index";

/**
 * The library pane in Groups view: one row per group (name, command, size). Selecting a row
 * opens its membership editor; the query matches a group name, command or member name.
 */
export function SkillGroupNavList({
  groups,
  ungroupedCount,
  query,
  selectedId,
  onSelect,
  onNewGroup,
}: {
  groups: SkillGroup[];
  ungroupedCount: number;
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewGroup: () => void;
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
      <EmptyState
        size="inline"
        title={t("No groups yet")}
        description={t("Groups run several skills with one command.")}
        action={{ label: t("New group"), onClick: onNewGroup }}
      />
    );
  return (
    <>
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
      {ungroupedCount ? (
        <div className="px-2 pt-2">
          <EmptyState
            size="inline"
            description={t(
              "{p0} skills are in no group. Filter by Ungrouped in a group to add them.",
              {
                p0: ungroupedCount,
              },
            )}
          />
        </div>
      ) : null}
    </>
  );
}
