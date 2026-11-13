import { useId, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { ContextMenu } from "../../../shared/ui/ContextMenu";
import { resolveSkillGroup, type SkillGroup } from "../index";
import type { SkillEntry } from "../model/skillLibrary";
import type { GroupEdit } from "./SkillGroupDialogs";
import { acceptSkillDrag, dropSkill } from "./useSkillGroupView";
import { useSortable } from "../../../shared/hooks/useSortable";
import { addSkillsToGroup, moveSkillBetweenGroups, removeSkillFromGroup } from "../index";
import styles from "./SkillsPage.module.css";

export function SkillGroupsList({
  groups,
  entries,
  shownEntries,
  collapsed,
  toggle,
  renderRow,
  onEdit,
  onError,
}: {
  groups: SkillGroup[];
  entries: SkillEntry[];
  shownEntries: SkillEntry[];
  collapsed: string[];
  toggle: (id: string) => void;
  renderRow: (entry: SkillEntry, groupId?: string) => ReactNode;
  onEdit: (edit: GroupEdit) => void;
  onError: (message: string) => void;
}) {
  useLocale();
  const grouped = new Set(groups.flatMap((group) => group.skillNames));
  const shown = new Set(shownEntries.map((entry) => entry.name));
  const sections = groups.map((group) => ({ group, ...resolveSkillGroup(group, entries) }));
  sections.push({
    group: {
      id: "ungrouped",
      name: t("Ungrouped"),
      skillNames: [],
      source: "manual",
      updatedAt: 0,
    },
    skills: entries.filter((entry) => !grouped.has(entry.name)),
    missingNames: [],
  });
  const dragRows = sections.flatMap(({ group, skills }) =>
    skills
      .filter((entry) => shown.has(entry.name))
      .map((entry) => ({
        id: JSON.stringify([group.id, entry.name]),
        source: group.id,
        name: entry.name,
      })),
  );
  // The sortable helper requires two IDs; a non-rendered sentinel allows moving a lone member to an empty group.
  const drag = useSortable([...dragRows.map((row) => row.id), "drag-sentinel"], () => {}, {
    axis: "y",
    canDropOn: (_id, kind) => kind === "group",
    onDropOnGroup: (id, target) => {
      const row = dragRows.find((item) => item.id === id);
      if (!row || row.source === target) return;
      try {
        if (target === "ungrouped") removeSkillFromGroup(row.source, row.name);
        else if (row.source === "ungrouped") addSkillsToGroup(target, [row.name]);
        else moveSkillBetweenGroups(row.source, target, row.name);
      } catch (cause) {
        onError(String(cause));
      }
    },
  });
  return (
    <>
      {sections.map(({ group, skills, missingNames }) => (
        <SkillGroupSection
          key={group.id}
          group={group}
          headerRef={(element) => drag.setGroupDropRef(group.id, element)}
          targeted={drag.dropTarget?.id === group.id}
          entries={skills.filter((entry) => shown.has(entry.name))}
          count={skills.length}
          missing={missingNames.length}
          expanded={!collapsed.includes(group.id)}
          toggle={() => toggle(group.id)}
          renderRow={(entry, source) => {
            const id = JSON.stringify([group.id, entry.name]);
            return (
              <div
                ref={(element) => drag.setItemRef(id, element)}
                onPointerDown={(event) => drag.onItemPointerDown(id, event)}
                onDragStart={(event) => event.preventDefault()}
                onClickCapture={(event) => {
                  if (drag.consumeClick()) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  // Pointer capture retargets the click to this wrapper; forward it to the control under the pointer.
                  if (event.target !== event.currentTarget) return;
                  const hit = document.elementFromPoint(event.clientX, event.clientY);
                  const control = hit?.closest<HTMLElement>("button, a, [role='button']");
                  if (
                    control &&
                    control !== event.currentTarget &&
                    event.currentTarget.contains(control)
                  ) {
                    event.stopPropagation();
                    control.click();
                  }
                }}
              >
                {renderRow(entry, source)}
              </div>
            );
          }}
          onEdit={onEdit}
          onDrop={(event) => {
            try {
              dropSkill(
                event,
                group.id === "ungrouped" ? undefined : group.id,
                new Set(entries.map((entry) => entry.name)),
              );
            } catch (cause) {
              onError(String(cause));
            }
          }}
        />
      ))}
    </>
  );
}

function SkillGroupSection({
  group,
  entries,
  count,
  missing,
  expanded,
  toggle,
  renderRow,
  onEdit,
  onDrop,
  headerRef,
  targeted,
}: {
  group: SkillGroup;
  entries: SkillEntry[];
  count: number;
  missing: number;
  expanded: boolean;
  toggle: () => void;
  renderRow: (entry: SkillEntry, groupId?: string) => ReactNode;
  onEdit: (edit: GroupEdit) => void;
  onDrop: React.DragEventHandler;
  headerRef: (element: HTMLDivElement | null) => void;
  targeted: boolean;
}) {
  const id = useId();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const source = group.id === "ungrouped" ? undefined : group.id;
  return (
    <section>
      <Surface
        ref={headerRef}
        variant="workspace-panel"
        padding="none"
        frame="none"
        radius="none"
        className={styles.groupHeader}
        onDragOver={acceptSkillDrag}
        onDrop={onDrop}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            setMenu(event.currentTarget);
          }
        }}
      >
        <SectionLabel
          host
          selected={targeted}
          collapsible
          expanded={expanded}
          onExpandedChange={toggle}
          controls={id}
          count={count}
        >
          {group.name}
        </SectionLabel>
        {missing ? (
          <Text size="caption" tone="secondary" className={styles.groupMissing}>
            {t("{p0} missing skills", { p0: missing })}
          </Text>
        ) : null}
      </Surface>
      <div id={id} hidden={!expanded}>
        {expanded
          ? entries.map((entry) => <div key={entry.key}>{renderRow(entry, source)}</div>)
          : null}
      </div>
      {menu ? (
        <ContextMenu
          anchor={menu}
          ariaLabel={group.name}
          onClose={() => setMenu(null)}
          items={[
            ...(source
              ? [
                  { kind: "item" as const, id: "rename", label: t("Rename group") },
                  { kind: "item" as const, id: "delete", label: t("Delete group"), danger: true },
                ]
              : []),
            { kind: "item", id: "collapse", label: expanded ? t("Collapse") : t("Expand") },
          ]}
          onPick={(action) => {
            if (action === "collapse") toggle();
            else onEdit({ kind: action === "rename" ? "rename" : "delete", group });
          }}
        />
      ) : null}
    </section>
  );
}
