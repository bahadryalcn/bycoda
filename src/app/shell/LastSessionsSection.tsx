import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Button } from "../../shared/ui/Button";
import { useMinuteNow } from "./RelativeSessionTime";
import { getLocale, useT } from "../../shared/i18n";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, Clock, Internet, Pin, PinOff } from "../../shared/ui/icons";
import { basename } from "../../platform/tauri/fs";
import { projectKey, projectName } from "../../shared/lib/paths";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import type { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { ExplorerMenu } from "../../features/files/ui/ExplorerMenu";
import {
  RAIL_DRAG_HANDLE,
  RAIL_SECTION_HEADER,
  SectionMenuButton,
  type RailSectionDrag,
} from "./useRailSections";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { useRecentSessions } from "../../features/sessions/hooks/useRecentSessions";
import {
  buildRecentSessions,
  formatRelative,
  loadRecentSessionsPrefs,
  RECENT_SESSION_COUNTS,
  recentCountLabel,
  saveRecentSessionsPrefs,
  type LiveSessionInfo,
  type RecentSessionRow,
  type RecentSessionsPrefs,
  type RecentSessionStatus,
} from "../../features/sessions/model/recentSessions";
import { HARNESS_TITLE } from "../../features/sessions/model/session";
import { resolveModel } from "../../features/sessions/model/models";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";

/** What the rail needs from the app to list sessions across projects. */
export type RecentSessionsSource = {
  /** The current project's session list; a change means something was saved, renamed, pinned or deleted. */
  history: SessionSummary[];
  /** Sessions held in memory: running state, and remote sessions the store never sees. */
  live: LiveSessionInfo[];
  onPin: (sessionId: string, pinned: boolean) => Promise<void>;
};

export type Appearance = {
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
};

/** Builds the rows a "Last sessions" list shows, for the rail section and the compact rail's popover alike. */
export function useLastSessionsRows({
  source,
  projectKeys,
  enabled,
}: {
  source: RecentSessionsSource;
  projectKeys: ReadonlySet<string>;
  enabled: boolean;
}) {
  const [prefs, setPrefs] = useState(loadRecentSessionsPrefs);
  const { rows: stored, refresh } = useRecentSessions(source.history, source.live, enabled);
  const rows = useMemo(
    () =>
      buildRecentSessions({
        stored,
        live: source.live,
        projectKeys,
        limit: prefs.count,
        now: Date.now(),
      }),
    [stored, source.live, projectKeys, prefs.count],
  );
  const update = (next: RecentSessionsPrefs) => {
    setPrefs(next);
    saveRecentSessionsPrefs(next);
  };
  const togglePin = (row: RecentSessionRow) => {
    void source.onPin(row.id, !row.pinned).then(refresh);
  };
  return { prefs, update, rows, hasRows: rows.length > 0, togglePin, refresh };
}

const STATUS_LABEL: Record<RecentSessionStatus, string> = {
  retrying: "Retrying",
  failed: "Failed",
  working: "Working",
  input: "Needs input",
  done: "Done",
};

const STATUS_DOT: Record<RecentSessionStatus, string> = {
  retrying: "bg-warning",
  failed: "bg-danger",
  working: "bg-accent animate-pulse motion-reduce:animate-none",
  input: "bg-warning",
  done: "bg-success",
};

export function LastSessionsSection({
  source,
  projectKeys,
  enabled,
  activeSessionId,
  searchActive,
  onOpenSession,
  onOpenProject,
  drag,
  onShownChange,
  ...appearance
}: {
  source: RecentSessionsSource;
  /** `pathKey` of every project on the rail; sessions of any other folder are left out. */
  projectKeys: ReadonlySet<string>;
  enabled: boolean;
  activeSessionId?: string;
  searchActive: boolean;
  onOpenSession?: (sessionId: string, options?: { keepOpen?: boolean }) => void;
  onOpenProject: (path: string) => void;
  /** Lets the rail move this section by its header. */
  drag?: RailSectionDrag;
  /** Reports whether the section is on screen: it has nothing to show without sessions. */
  onShownChange?: (shown: boolean) => void;
} & Appearance) {
  const t = useT();
  const { prefs, update, rows, hasRows, togglePin } = useLastSessionsRows({
    source,
    projectKeys,
    enabled,
  });
  useEffect(() => {
    onShownChange?.(hasRows);
    return () => onShownChange?.(false);
  }, [hasRows, onShownChange]);
  if (!hasRows) return null;

  return (
    <div ref={drag?.setRef} className="reorder-item rail-reorder-block mb-2 shrink-0">
      <div
        {...drag?.headerProps}
        title={drag ? t("Drag to reorder") : undefined}
        className={`${RAIL_SECTION_HEADER} ${drag ? RAIL_DRAG_HANDLE : ""}`}
      >
        <Button
          variant="item"
          motion="none"
          type="button"
          aria-expanded={!prefs.collapsed}
          onClick={() => update({ ...prefs, collapsed: !prefs.collapsed })}
          size="sm"
          className={`min-w-0 flex-1 ${drag ? "cursor-grab" : ""}`}
        >
          <Clock
            className="icon-sm shrink-0 group-hover:hidden group-has-[button:focus-visible]:hidden"
            strokeWidth={1.75}
          />
          <ChevronDown
            className={`hidden size-3.5 shrink-0 group-hover:block group-has-[button:focus-visible]:block ${
              prefs.collapsed ? "-rotate-90" : ""
            }`}
            strokeWidth={1.75}
          />
          <span className="truncate">{t("Last sessions")}</span>
        </Button>
        {prefs.collapsed ? null : (
          <CountPicker count={prefs.count} onChange={(count) => update({ ...prefs, count })} />
        )}
        {drag ? <SectionMenuButton label={t("Last sessions")} onOpen={drag.openMenu} /> : null}
      </div>
      {prefs.collapsed ? null : (
        <LastSessionsRows
          rows={rows}
          activeSessionId={activeSessionId}
          searchActive={searchActive}
          onOpenSession={onOpenSession}
          onOpenProject={onOpenProject}
          onTogglePin={togglePin}
          className={drag?.folded ? "hidden" : "flex"}
          {...appearance}
        />
      )}
    </div>
  );
}

/** The rows of a "Last sessions" list and their context menu; shared by the rail section and the compact rail's popover. */
export function LastSessionsRows({
  rows,
  activeSessionId,
  searchActive,
  onOpenSession,
  onOpenProject,
  onTogglePin,
  className,
  ...appearance
}: {
  rows: RecentSessionRow[];
  activeSessionId?: string;
  searchActive: boolean;
  onOpenSession?: (sessionId: string, options?: { keepOpen?: boolean }) => void;
  onOpenProject: (path: string) => void;
  onTogglePin: (row: RecentSessionRow) => void;
  className?: string;
} & Appearance) {
  const t = useT();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    row: RecentSessionRow;
  } | null>(null);
  const now = useMinuteNow();
  const menuRow = menu?.row;

  return (
    <>
      <div
        role="list"
        aria-label={t("Last sessions")}
        className={`flex-col gap-px overflow-y-auto px-2 ${className ?? ""}`}
      >
        {rows.map((row) => (
          <SessionRow
            key={row.id}
            row={row}
            now={now}
            selected={!searchActive && row.id === activeSessionId}
            onOpen={() => onOpenSession?.(row.id)}
            onKeepOpen={() => onOpenSession?.(row.id, { keepOpen: true })}
            onTogglePin={() => onTogglePin(row)}
            onOpenMenu={(x, y) => setMenu({ x, y, row })}
            {...appearance}
          />
        ))}
      </div>
      {menu && menuRow ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Session actions"
          items={[
            {
              kind: "item",
              id: "open",
              get label() {
                return t("Open");
              },
            },
            ...(menuRow.pinnable
              ? [
                  {
                    kind: "item" as const,
                    id: "pin",
                    label: menuRow.pinned ? "Unpin" : "Pin",
                  },
                ]
              : []),
            {
              kind: "item",
              id: "project",
              get label() {
                return t("Open project");
              },
            },
          ]}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onOpenSession?.(menuRow.id);
            else if (id === "pin") onTogglePin(menuRow);
            else if (id === "project") onOpenProject(menuRow.cwd);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}

function CountPicker({
  count,
  onChange,
}: {
  count: RecentSessionsPrefs["count"];
  onChange: (count: RecentSessionsPrefs["count"]) => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        motion="none"
        ref={anchor}
        type="button"
        data-no-drag
        title={t("Sessions shown")}
        aria-label={t("Sessions shown: {p0}", { p0: recentCountLabel(count) })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        size="sm"
        className="shrink-0 tabular-nums"
      >
        {count === 50 ? t("All") : count}
        <ChevronDown className="icon-xs" strokeWidth={1.75} />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Sessions shown")}
          returnFocusRef={anchor}
          width={180}
          align="end"
          onClose={() => setOpen(false)}
          onPick={(id) => onChange(Number(id) as RecentSessionsPrefs["count"])}
          items={RECENT_SESSION_COUNTS.map((option) => ({
            kind: "item",
            id: String(option),
            label: recentCountLabel(option),
            checked: option === count,
            selectionRole: "radio",
          }))}
        />
      ) : null}
    </>
  );
}

function SessionRow({
  row,
  now,
  selected,
  onOpen,
  onKeepOpen,
  onTogglePin,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  row: RecentSessionRow;
  now: number;
  selected: boolean;
  onOpen: () => void;
  onKeepOpen: () => void;
  onTogglePin: () => void;
  onOpenMenu: (x: number, y: number) => void;
} & Appearance) {
  const t = useT();
  const key = projectKey(row.cwd);
  const seed = projectName(row.cwd);
  const project = resolveTabGroupLabel(key, groupLabels, basename(row.cwd));
  const logoPath = resolveTabGroupLogo(key, groupLogos);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const agent = HARNESS_TITLE[row.harness];
  const model = row.model ? resolveModel(row.harness, row.model).name : "";
  const time = formatRelative(row.updatedAt, now);
  const status = row.status;
  const location = row.remote ? `${remoteProjectFor(row.cwd)?.cwd ?? row.cwd} (remote)` : row.cwd;
  const tooltip = [
    row.title,
    `${project} · ${location}`,
    model ? `${agent} · ${model}` : agent,
    status
      ? STATUS_LABEL[status]
      : time && `Last activity ${new Date(row.updatedAt).toLocaleString(getLocale())}`,
  ]
    .filter(Boolean)
    .join("\n");

  const openMenuAt = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenMenu(event.clientX, event.clientY);
  };

  return (
    <div
      role="listitem"
      data-selected={selected || undefined}
      className="group relative flex"
      onContextMenu={openMenuAt}
    >
      <Button
        variant="item"
        motion="none"
        type="button"
        title={tooltip}
        selected={selected}
        aria-current={selected ? "true" : undefined}
        aria-label={[row.title, project, agent, status ? STATUS_LABEL[status].toLowerCase() : time]
          .filter(Boolean)
          .join(", ")}
        onClick={onOpen}
        onDoubleClick={onKeepOpen}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom);
        }}
        layout="stacked"
        className="min-w-0 flex-1"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui-secondary font-medium leading-5">
            {row.title}
          </span>
          {status ? (
            <span
              role="img"
              aria-label={STATUS_LABEL[status]}
              title={STATUS_LABEL[status]}
              className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
            />
          ) : null}
          {time ? (
            <span className="shrink-0 text-ui-micro tabular-nums text-(--ui-text-secondary)">
              {time}
            </span>
          ) : null}
        </span>
        <span
          className={`flex min-w-0 items-center gap-1.5 text-ui-micro leading-4 text-(--ui-text-secondary) ${row.pinnable ? "pe-7" : ""}`}
        >
          <span className="grid size-3 shrink-0 place-items-center" aria-hidden="true">
            {logoPath && status !== "working" ? (
              <ProjectLogoIcon
                path={logoPath}
                className="size-3 rounded-sm"
                imageClassName="size-3"
              />
            ) : (
              <ProjectMascot
                project={seed}
                color={color}
                name={resolveTabGroupMascot(key, groupMascots)}
                className="size-3"
                active={status === "working"}
              />
            )}
          </span>
          {row.pinned ? (
            <Pin
              aria-label={t("Pinned")}
              className="size-3 shrink-0 text-(--ui-text-secondary)"
              strokeWidth={1.75}
            />
          ) : null}
          {row.remote ? (
            <Internet
              aria-label={t("On another machine")}
              className="size-3 shrink-0"
              strokeWidth={1.75}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{project}</span>
          <span className="flex shrink-0 items-center gap-1">
            <span aria-hidden="true">·</span>
            <HarnessIcon harness={row.harness} className="size-3 shrink-0" />
            <span>{agent}</span>
          </span>
        </span>
      </Button>
      {row.pinnable ? (
        <Button
          variant="ghost"
          motion="none"
          type="button"
          iconOnly
          size="sm"
          label={row.pinned ? t("Unpin session") : t("Pin session")}
          title={row.pinned ? t("Unpin session") : t("Pin session")}
          aria-label={row.pinned ? t("Unpin session") : t("Pin session")}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          className="absolute end-1 bottom-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        >
          {row.pinned ? (
            <PinOff className="icon-sm" strokeWidth={1.75} />
          ) : (
            <Pin className="icon-sm" strokeWidth={1.75} />
          )}
        </Button>
      ) : null}
    </div>
  );
}
