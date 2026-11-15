import { useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { ListFilter, MoreHorizontal, Plus } from "../../../shared/ui/icons";
import type { SkillListFilter } from "../model/skillLibrary";

/**
 * The skills library's one control row: view (All / Groups), a filter menu for the enabled
 * state, and a trailing "New" menu that holds every creation action. Skill folders live in
 * the overflow menu so no permanent footer is needed.
 */
export function SkillsLibraryToolbar({
  view,
  onView,
  filter,
  onFilter,
  showMissing,
  busy,
  onNewSkill,
  onDiscover,
  onNewGroup,
  onFolders,
}: {
  view: string;
  onView: (view: string) => void;
  filter: SkillListFilter;
  onFilter: (filter: SkillListFilter) => void;
  showMissing: boolean;
  busy: boolean;
  onNewSkill: () => void;
  onDiscover: () => void;
  onNewGroup: () => void;
  onFolders: () => void;
}) {
  const [open, setOpen] = useState<"filter" | "new" | "more" | null>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const filters: { id: SkillListFilter; label: string }[] = [
    { id: "all", label: t("All") },
    { id: "enabled", label: t("Enabled") },
    { id: "off", label: t("Off") },
    ...(showMissing ? [{ id: "missing" as const, label: t("Missing") }] : []),
  ];
  const close = () => setOpen(null);
  return (
    <div className="flex items-center gap-1">
      <SegmentedControl
        label={t("Skill view")}
        size="sm"
        value={view}
        onValueChange={onView}
        options={[
          { value: "all", label: t("All skills") },
          { value: "groups", label: t("Groups") },
        ]}
      />
      <span className="ml-auto" />
      <Button
        ref={filterTrigger}
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Filter")}
        pressed={filter !== "all"}
        aria-haspopup="menu"
        aria-expanded={open === "filter"}
        onClick={() => setOpen(open === "filter" ? null : "filter")}
      >
        <ListFilter className="icon-sm" aria-hidden />
      </Button>
      <Button
        ref={newTrigger}
        size="sm"
        startIcon={<Plus />}
        aria-haspopup="menu"
        aria-expanded={open === "new"}
        onClick={() => setOpen(open === "new" ? null : "new")}
      >
        {t("New")}
      </Button>
      <Button
        ref={moreTrigger}
        variant="ghost"
        size="sm"
        iconOnly
        label={t("More")}
        aria-haspopup="menu"
        aria-expanded={open === "more"}
        onClick={() => setOpen(open === "more" ? null : "more")}
      >
        <MoreHorizontal className="icon-sm" aria-hidden />
      </Button>
      {open === "filter" ? (
        <DropdownMenu
          anchor={filterTrigger}
          label={t("Show skills")}
          returnFocusRef={filterTrigger}
          align="end"
          onClose={close}
          onPick={(id) => onFilter(id as SkillListFilter)}
          items={filters.map((item) => ({
            kind: "item" as const,
            id: item.id,
            label: item.label,
            checked: item.id === filter,
            selectionRole: "radio" as const,
          }))}
        />
      ) : null}
      {open === "new" ? (
        <DropdownMenu
          anchor={newTrigger}
          label={t("New")}
          returnFocusRef={newTrigger}
          align="end"
          onClose={close}
          onPick={(id) => {
            if (id === "skill") onNewSkill();
            else if (id === "group") onNewGroup();
            else onDiscover();
          }}
          items={[
            { kind: "item", id: "skill", label: t("New skill"), disabled: busy },
            { kind: "item", id: "group", label: t("New group") },
            { kind: "item", id: "discover", label: t("Discover skills") },
          ]}
        />
      ) : null}
      {open === "more" ? (
        <DropdownMenu
          anchor={moreTrigger}
          label={t("More")}
          returnFocusRef={moreTrigger}
          align="end"
          onClose={close}
          onPick={() => onFolders()}
          items={[{ kind: "item", id: "folders", label: t("Skill folders") }]}
        />
      ) : null}
    </div>
  );
}
