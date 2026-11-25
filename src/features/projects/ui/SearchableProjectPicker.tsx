import {
  PickerList,
  PickerPopover,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import { basename } from "../../../platform/tauri/fs";
import { prettyParent, projectKey, projectName } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  isLocalProject,
  projectRailItemsFrom,
  useProjectRailLayout,
  sameProjectPath,
  type RecentProject,
} from "../model/recents";
import {
  resolveTabGroupColor,
  resolveTabGroupLabel,
  useResolvedTabGroupLogo,
  resolveTabGroupMascot,
  useTabGroupColors,
  useTabGroupCustomColors,
  useTabGroupMascots,
} from "../../workspace/model/tabGroups";
import { useProjectLabels } from "../model/projectNames";
import { Plus } from "../../../shared/ui/icons";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { ProjectMascot } from "./ProjectMascot";
import { PROJECT_WINDOW_THRESHOLD, ProjectOptionIcon } from "./ProjectOptionIcon";

function ProjectPickerResults({
  choices,
  selected,
  searchRef,
  onPick,
}: {
  choices: readonly (PickerOption & { searchText: string })[];
  selected?: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const list = usePickerList({
    options: needle ? choices.filter((choice) => choice.searchText.includes(needle)) : choices,
    value: selected,
    inputRef: searchRef,
    resetKey: query,
    onChange: onPick,
  });
  return (
    <>
      <PopoverSearchHeader
        {...list.searchProps}
        size="md"
        autoFocus={false}
        label={t("Search projects")}
        placeholder={t("Search projects…")}
        value={query}
        onValueChange={setQuery}
        headerClassName="shrink-0"
      />
      <PickerList
        label={t("Project picker")}
        controller={list}
        emptyLabel={t("No projects found")}
        windowed={choices.length > PROJECT_WINDOW_THRESHOLD}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none"
      />
    </>
  );
}

type Props = {
  cwd: string;
  recents: RecentProject[];
  /** Project whose rail supplies the choices when it differs from `cwd`. */
  railCwd?: string;
  busy?: boolean;
  disabled?: boolean;
  /** Hide targets unsupported by desktop-only filesystem integrations. */
  localOnly?: boolean;
  mode?: "switch" | "move";
  /** Accessible name before a project is selected. */
  chooseLabel?: string;
  /** Accessible action paired with the current project name. */
  actionLabel?: string;
  className?: string;
  buttonClassName?: string;
  appearance?: "ghost" | "filled";
  compact?: boolean;
  onSelectProject: (path: string) => void;
  onOpenProject?: () => void;
  /** Opens the project's context menu; the search input receives focus back. */
  onProjectContextMenu?: (path: string, x: number, y: number, trigger: HTMLElement | null) => void;
  /** Keeps the dropdown open while the project's context menu or its dialogs show. */
  projectMenuActive?: boolean;
};

export function SearchableProjectPicker({
  cwd,
  recents,
  railCwd,
  busy = false,
  disabled = false,
  localOnly = false,
  mode = "switch",
  chooseLabel,
  actionLabel,
  className,
  buttonClassName,
  appearance = "ghost",
  compact = false,
  onSelectProject,
  onOpenProject,
  onProjectContextMenu,
  projectMenuActive = false,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const groupLabels = useProjectLabels();
  const groupColors = useTabGroupColors();
  const groupCustomColors = useTabGroupCustomColors();
  const groupMascots = useTabGroupMascots();
  const groupLogos = useTabGroupLogos();
  const inProject = looksLikeProject(cwd);
  const seed = projectName(cwd);
  const key = projectKey(cwd);
  const label = inProject
    ? resolveTabGroupLabel(key, groupLabels, basename(cwd) || seed)
    : t("Choose project");
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const railLayout = useProjectRailLayout();
  const logoPath = useResolvedTabGroupLogo(key, groupLogos);
  const railProjects = open ? projectRailItemsFrom(recents, railCwd ?? cwd, railLayout) : [];
  const currentProject = railProjects.find((item) => sameProjectPath(item.path, cwd));
  const selected = currentProject?.path ?? (inProject ? cwd : undefined);
  const paths = railProjects.filter((item) => item !== currentProject).map((item) => item.path);
  if (open && selected) paths.unshift(selected);

  const closePicker = () => setOpen(false);

  const openPicker = () => {
    if (disabled) return;
    setOpen(true);
  };

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- focus search on open and again after the anchored popover is placed
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const pickProject = (path: string) => {
    if (disabled || (localOnly && !isLocalProject(path))) return;
    closePicker();
    if (!sameProjectPath(path, cwd)) onSelectProject(path);
  };

  const choices = paths
    .filter((path) => !localOnly || isLocalProject(path))
    .map((path) => {
      const itemKey = projectKey(path);
      const seed = projectName(path);
      const title = resolveTabGroupLabel(itemKey, groupLabels, basename(path) || seed);
      return {
        value: path,
        title,
        searchText: `${title}\n${path}`.toLocaleLowerCase(),
        meta: prettyParent(path),
        icon: (
          <ProjectOptionIcon
            project={itemKey}
            seed={seed}
            logos={groupLogos}
            color={resolveTabGroupColor(itemKey, groupColors, groupCustomColors, seed)}
            mascot={resolveTabGroupMascot(itemKey, groupMascots)}
            logoClassName="icon-sm"
            mascotClassName="icon-sm"
          />
        ),
        onContextMenu: onProjectContextMenu
          ? (event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onProjectContextMenu(path, event.clientX, event.clientY, searchRef.current);
            }
          : undefined,
      };
    });

  const choose = chooseLabel ?? t("Choose project for note");
  const action = actionLabel ?? (mode === "move" ? t("Move note to project") : t("Switch project"));

  return (
    <div
      ref={pickerRef}
      className={`relative flex h-full min-w-0 items-center${className ? ` ${className}` : ""}`}
    >
      <Button
        variant="item"
        iconOnly={compact}
        label={choose}
        motion="none"
        type="button"
        disabled={disabled}
        disabledReason={disabled ? t("Not available right now.") : undefined}
        tooltip={inProject ? cwd : undefined}
        aria-label={inProject ? t("{p0}, current project {p1}", { p0: action, p1: label }) : choose}
        selected={open || appearance === "filled"}
        expanded={compact ? undefined : open}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tauri-drag-region="false"
        onClick={() => (open ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openPicker();
        }}
        leading="none"
        className={`flex min-w-0 items-center ${compact ? "justify-center" : "gap-1.5"}${
          buttonClassName ? ` ${buttonClassName}` : ""
        }`}
      >
        {!inProject ? null : logoPath ? (
          <ProjectLogoIcon
            path={logoPath}
            className="icon-sm shrink-0 rounded-sm"
            imageClassName="icon-sm"
          />
        ) : (
          <ProjectMascot
            project={seed}
            color={color}
            name={resolveTabGroupMascot(key, groupMascots)}
            className="icon-sm shrink-0"
            active={busy}
          />
        )}
        {compact ? null : (
          <Text truncate size="inherit" tone="primary" weight="medium" className="min-w-0">
            {label}
          </Text>
        )}
      </Button>
      {open && !disabled ? (
        <PickerPopover
          open
          anchor={pickerRef}
          side="bottom"
          align="start"
          size="md"
          maxHeight={380}
          label={t("Project picker")}
          onDismiss={closePicker}
          dismissible={!projectMenuActive}
          inputRef={searchRef}
        >
          <ProjectPickerResults
            choices={choices}
            selected={selected}
            searchRef={searchRef}
            onPick={pickProject}
          />
          {onOpenProject ? (
            <div className="shrink-0">
              <Button
                variant="item"
                motion="none"
                type="button"
                onClick={() => {
                  closePicker();
                  onOpenProject();
                }}
                className="flex w-full items-center gap-2.5 text-start"
              >
                <Plus className="icon-sm shrink-0" strokeWidth={1.75} />
                <span>{t("New project")}</span>
              </Button>
            </div>
          ) : null}
        </PickerPopover>
      ) : null}
    </div>
  );
}
