import { useRef, useState } from "react";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Divider } from "../../../shared/ui/Divider";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { MoreHorizontal, Pencil, Trash2, X } from "../../../shared/ui/icons";
import { skillGroupInvocation, type SkillGroup } from "../index";
import { setSkillGroupMembers } from "../model/skillGroups";
import type { SkillEntry } from "../model/skillLibrary";
import type { GroupEdit } from "./SkillGroupDialogs";
import styles from "./SkillsPage.module.css";

type MemberFilter = "all" | "members" | "ungrouped";

/**
 * Membership editor for one group: search every installed skill and check or uncheck many at
 * once. Each change is one durable write, so there is no draft to lose when switching groups.
 */
export function SkillGroupEditor({
  group,
  groups,
  entries,
  onEdit,
  onClose,
}: {
  group: SkillGroup;
  groups: SkillGroup[];
  entries: SkillEntry[];
  onEdit: (edit: GroupEdit) => void;
  /** Back to the group list; on narrow widths the editor replaces it. */
  onClose: () => void;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const members = new Set(group.skillNames);
  const membership = () => ({
    members: new Set(group.skillNames),
    grouped: new Set(groups.flatMap((entry) => entry.skillNames)),
  });
  // Filters match membership as of the last filter or search change, so a checked row stays in
  // place (and keeps focus) instead of leaving "Ungrouped" or "In group" mid-review.
  const [basis, setBasis] = useState(membership);
  const installed = new Set(entries.map((entry) => entry.name));
  const missing = group.skillNames.filter((name) => !installed.has(name));
  const needle = query.trim().toLocaleLowerCase();
  const shown = entries.filter(
    (entry) =>
      (filter === "all" ||
        (filter === "members" ? basis.members.has(entry.name) : !basis.grouped.has(entry.name))) &&
      (!needle ||
        entry.name.toLocaleLowerCase().includes(needle) ||
        entry.primary.skill.description.toLocaleLowerCase().includes(needle)),
  );
  const checkedShown = shown.filter((entry) => members.has(entry.name)).length;
  const apply = (add: string[], remove: string[]) => {
    try {
      setSkillGroupMembers(group.id, add, remove);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const allShown = shown.length > 0 && checkedShown === shown.length;
  return (
    <section aria-label={t("Edit {p0}", { p0: group.name })} className={styles.detail}>
      <header className={styles.detailHeader}>
        <div className={styles.headingRow}>
          <Heading size="page" level={2}>
            {group.name}
          </Heading>
          <Button
            ref={moreTrigger}
            variant="ghost"
            size="sm"
            iconOnly
            label={t("More")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MoreHorizontal className="icon-sm" aria-hidden />
          </Button>
          {menuOpen ? (
            <DropdownMenu
              anchor={moreTrigger}
              label={t("More")}
              returnFocusRef={moreTrigger}
              align="end"
              onClose={() => setMenuOpen(false)}
              onPick={(id) => onEdit({ kind: id === "rename" ? "rename" : "delete", group })}
              items={[
                { kind: "item", id: "rename", label: t("Rename"), icon: <Pencil className="icon-sm" /> },
                {
                  kind: "item",
                  id: "delete",
                  label: t("Delete group"),
                  danger: true,
                  icon: <Trash2 className="icon-sm" />,
                },
              ]}
            />
          ) : null}
          <Button variant="ghost" size="sm" iconOnly label={t("Close group")} onClick={onClose}>
            <X className="icon-sm" aria-hidden />
          </Button>
        </div>
        <Text size="caption" tone="secondary">
          {t("/{p0} runs {p1} skills", {
            p0: skillGroupInvocation(group),
            p1: group.skillNames.length,
          })}
        </Text>
      </header>
      <div className={styles.groupEditorToolbar}>
        <TextField
          type="search"
          label={t("Filter skills to add")}
          hideLabel
          value={query}
          placeholder={t("Search skills")}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setBasis(membership());
          }}
        />
        <SegmentedControl
          label={t("Show")}
          size="sm"
          value={filter}
          onValueChange={(value) => {
            setFilter(value as MemberFilter);
            setBasis(membership());
          }}
          options={[
            { value: "all", label: t("All") },
            { value: "members", label: t("In group") },
            { value: "ungrouped", label: t("Ungrouped") },
          ]}
        />
      </div>
      {error ? (
        <div className={styles.groupEditorNote}>
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {missing.length ? (
        <div className={`${styles.groupEditorNote} ${styles.headingRow}`}>
          <Text size="caption" tone="secondary" className="min-w-0 flex-1">
            {t("{p0} missing skills stay in the group: {p1}", {
              p0: missing.length,
              p1: missing.join(", "),
            })}
          </Text>
          <Button variant="ghost" size="sm" onClick={() => apply([], missing)}>
            {t("Remove missing")}
          </Button>
        </div>
      ) : null}
      {shown.length ? (
        <>
          <div className={styles.groupEditorBulk}>
            <Checkbox
              size="secondary"
              label={t("Select all {p0} shown", { p0: shown.length })}
              checked={allShown}
              indeterminate={checkedShown > 0 && !allShown}
              onChange={() =>
                allShown
                  ? apply(
                      [],
                      shown.map((entry) => entry.name),
                    )
                  : apply(
                      shown.filter((entry) => !members.has(entry.name)).map((entry) => entry.name),
                      [],
                    )
              }
            />
          </div>
          <Divider decorative />
          <ScrollArea className={styles.groupEditorList} gutter="stable" aria-label={t("Skills")}>
            {shown.map((entry) => (
              <Checkbox
                key={entry.key}
                appearance="row"
                size="secondary"
                label={entry.name}
                description={entry.primary.skill.description || undefined}
                checked={members.has(entry.name)}
                onChange={(event) =>
                  event.currentTarget.checked ? apply([entry.name], []) : apply([], [entry.name])
                }
              />
            ))}
          </ScrollArea>
        </>
      ) : (
        <EmptyState
          context="list"
          kind="filtered"
          icon={null}
          description={t("No matching skills")}
          onReset={() => {
            setQuery("");
            setFilter("all");
          }}
          resetLabel={t("Clear filters")}
        />
      )}
    </section>
  );
}
