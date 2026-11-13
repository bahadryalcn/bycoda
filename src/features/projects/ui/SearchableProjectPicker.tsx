import { PickerList, PickerPopover, usePickerList } from "../../../shared/ui/picker";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import { basename } from "../../../platform/tauri/fs";
import { prettyParent, projectKey, projectName } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  isLocalProject,
  projectRailItemsFrom,
  useProjectRailLayout,
  sameProjectPath,
  subscribeProjectPathsChanged,
  type RecentProject,
} from "../model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  useResolvedTabGroupLogos,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { ChevronDown, Plus } from "../../../shared/ui/icons";
import { motionAttributes } from "../../../shared/ui/Motion";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { ProjectMascot } from "./ProjectMascot";

function loadAppearance() {
  return {
    groupLabels: loadTabGroupLabels(),
    groupColors: loadTabGroupColors(),
    groupCustomColors: loadTabGroupCustomColors(),
    groupMascots: loadTabGroupMascots(),
  };
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
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [{ groupLabels, groupColors, groupCustomColors, groupMascots }, setAppearance] =
    useState(loadAppearance);
  useEffect(() => subscribeProjectPathsChanged(() => setAppearance(loadAppearance())), []);
  const groupLogos = useTabGroupLogos();
  const inProject = looksLikeProject(cwd);
  const seed = projectName(cwd);
  const key = projectKey(cwd);
  const label = inProject
    ? resolveTabGroupLabel(key, groupLabels, basename(cwd) || seed)
    : t("Choose project");
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const railLayout = useProjectRailLayout();
  const railProjects = projectRailItemsFrom(recents, railCwd ?? cwd, railLayout);
  const projects =
    inProject && !railProjects.some((item) => sameProjectPath(item.path, cwd))
      ? [{ path: cwd, openedAt: 0 }, ...railProjects]
      : railProjects;
  const orderedProjects = [
    ...projects.filter((item) => sameProjectPath(item.path, cwd)),
    ...projects.filter((item) => !sameProjectPath(item.path, cwd)),
  ].filter((item) => !localOnly || isLocalProject(item.path));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredProjects = normalizedQuery
    ? orderedProjects.filter((item) => {
        const itemKey = projectKey(item.path);
        const itemLabel = resolveTabGroupLabel(
          itemKey,
          groupLabels,
          basename(item.path) || projectName(item.path),
        );
        return `${itemLabel}\n${item.path}`.toLocaleLowerCase().includes(normalizedQuery);
      })
    : orderedProjects;
  const resolvedLogos = useResolvedTabGroupLogos(
    [key, ...filteredProjects.map((item) => projectKey(item.path))],
    groupLogos,
  );
  const logoPath = resolvedLogos[key] ?? null;

  const closePicker = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const openPicker = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setActive(0);
  };

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

  const list = usePickerList({
    options: filteredProjects.map((item) => {
      const itemKey = projectKey(item.path);
      const seed = projectName(item.path);
      const logo = resolvedLogos[itemKey];
      return {
        value: item.path,
        title: resolveTabGroupLabel(itemKey, groupLabels, basename(item.path) || seed),
        meta: prettyParent(item.path),
        icon: logo ? (
          <ProjectLogoIcon path={logo} className="size-4" imageClassName="size-4" />
        ) : (
          <ProjectMascot
            project={seed}
            color={resolveTabGroupColor(itemKey, groupColors, groupCustomColors, seed)}
            name={resolveTabGroupMascot(itemKey, groupMascots)}
            className="size-3.5"
          />
        ),
        onContextMenu: onProjectContextMenu
          ? (event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onProjectContextMenu(item.path, event.clientX, event.clientY, searchRef.current);
            }
          : undefined,
      };
    }),
    value: filteredProjects.find((item) => sameProjectPath(item.path, cwd))?.path,
    activeValue: filteredProjects[active]?.path ?? null,
    onActiveValueChange: (value) =>
      setActive(filteredProjects.findIndex((item) => item.path === value)),
    inputRef: searchRef,
    onChange: pickProject,
  });

  const action = mode === "move" ? t("Move note to project") : t("Switch project");

  return (
    <div
      ref={pickerRef}
      className={`relative flex h-full min-w-0 items-center${className ? ` ${className}` : ""}`}
    >
      <Button
        variant="item"
        iconOnly={compact}
        label={t("Choose project for note")}
        motion="none"
        type="button"
        disabled={disabled}
        tooltip={inProject ? cwd : undefined}
        aria-label={
          inProject
            ? t("{p0}, current project {p1}", { p0: action, p1: label })
            : t("Choose project for note")
        }
        selected={open || appearance === "filled"}
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
        className={` flex min-w-0 items-center  ${
          compact ? "justify-center" : "gap-1.5"
        }     ${buttonClassName ? `   ${buttonClassName}  ` : ""}  `}
      >
        {!inProject ? null : logoPath ? (
          <ProjectLogoIcon
            path={logoPath}
            className={`${compact ? "size-4" : "size-3.5"} shrink-0 rounded-sm`}
            imageClassName={compact ? "size-4" : "size-3.5"}
          />
        ) : (
          <ProjectMascot
            project={seed}
            color={color}
            name={resolveTabGroupMascot(key, groupMascots)}
            className={`${compact ? "size-3.5" : "size-3"} shrink-0`}
            active={busy}
          />
        )}
        {compact ? null : (
          <>
            <Text truncate size="inherit" tone="primary" weight="medium" className="min-w-0">
              {label}
            </Text>
            <ChevronDown
              tone="muted"
              {...motionAttributes(
                { transition: "transform", duration: "standard", easing: "sheen" },
                `icon-xs shrink-0 ${open ? "rotate-180" : ""}`,
              )}
              strokeWidth={1.75}
            />
          </>
        )}
      </Button>
      {open && !disabled ? (
        <PickerPopover
          open
          anchor={pickerRef}
          side="bottom"
          align="start"
          width={286}
          maxHeight={380}
          label={t("Project picker")}
          onDismiss={closePicker}
          dismissible={!projectMenuActive}
          inputRef={searchRef}
        >
          <PopoverSearchHeader
            {...list.searchProps}
            size="md"
            autoFocus={false}
            label={t("Search projects")}
            placeholder={t("Search projects...")}
            value={query}
            onValueChange={(next) => {
              setQuery(next);
              setActive(0);
            }}
            headerClassName="shrink-0"
          />
          <PickerList
            label={t("Project picker")}
            controller={list}
            emptyLabel={t("No projects found")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none"
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
                className="flex w-full items-center gap-2.5 text-left"
              >
                <Plus className="icon-md shrink-0" strokeWidth={1.75} />
                <span>{t("New project")}</span>
              </Button>
            </div>
          ) : null}
        </PickerPopover>
      ) : null}
    </div>
  );
}
