import { t, useLocale, getLocale } from "../../shared/i18n";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Check, ChevronDown, Clock, Internet, Pin, PinOff } from "../../shared/ui/icons";
import { basename } from "../../platform/tauri/fs";
import { projectKey, projectName } from "../../shared/lib/paths";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import type { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { ExplorerMenu } from "../../features/files/ui/ExplorerMenu";
import { Popover } from "../../shared/ui/Popover";
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

const MENU_ITEM =
  "flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-content/80 hover:bg-content/8 hover:text-content";

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
  onOpenSession?: (sessionId: string) => void;
  onOpenProject: (path: string) => void;
  /** Lets the rail move this section by its header. */
  drag?: RailSectionDrag;
  /** Reports whether the section is on screen: it has nothing to show without sessions. */
  onShownChange?: (shown: boolean) => void;
} & Appearance) {
  useLocale();
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
        <button
          type="button"
          aria-expanded={!prefs.collapsed}
          onClick={() => update({ ...prefs, collapsed: !prefs.collapsed })}
          className={`flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-xs font-medium text-content/70 hover:text-content ${
            drag ? "cursor-grab" : ""
          }`}
        >
          <Clock
            className="size-3.5 shrink-0 group-hover:hidden group-has-[:focus-visible]:hidden"
            strokeWidth={1.75}
          />
          <ChevronDown
            className={`hidden size-3.5 shrink-0 group-hover:block group-has-[:focus-visible]:block ${
              prefs.collapsed ? "-rotate-90" : ""
            }`}
            strokeWidth={1.75}
          />
          <span className="truncate">{t("Last sessions")}</span>
        </button>
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
          className={`max-h-[min(20rem,35vh)] ${drag?.folded ? "hidden" : "flex"}`}
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
  onOpenSession?: (sessionId: string) => void;
  onOpenProject: (path: string) => void;
  onTogglePin: (row: RecentSessionRow) => void;
  className?: string;
} & Appearance) {
  useLocale();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    row: RecentSessionRow;
  } | null>(null);
  const now = Date.now();
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
  useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-no-drag
        title={t("Sessions shown")}
        aria-label={t("Sessions shown: {p0}", { p0: recentCountLabel(count) })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1 text-[11px] font-semibold tabular-nums text-content/50 hover:bg-content/8 hover:text-content aria-expanded:bg-content/8 aria-expanded:text-content"
      >
        {count === 50 ? t("All") : count}
        <ChevronDown className="size-3" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          align="end"
          width={180}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label={t("Sessions shown")}
          className="p-1"
        >
          {RECENT_SESSION_COUNTS.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === count}
              className={MENU_ITEM}
              onClick={() => {
                setOpen(false);
                onChange(option);
              }}
            >
              {recentCountLabel(option)}
              {option === count ? <Check className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
            </button>
          ))}
        </Popover>
      ) : null}
    </>
  );
}

function SessionRow({
  row,
  now,
  selected,
  onOpen,
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
  onTogglePin: () => void;
  onOpenMenu: (x: number, y: number) => void;
} & Appearance) {
  useLocale();
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
      className={`group relative flex rounded-md ${
        selected
          ? "bg-selection-strong text-content"
          : "opacity-80 hover:bg-content/8 hover:opacity-100"
      }`}
      onContextMenu={openMenuAt}
    >
      <button
        type="button"
        title={tooltip}
        aria-current={selected ? "true" : undefined}
        aria-label={[row.title, project, agent, status ? STATUS_LABEL[status].toLowerCase() : time]
          .filter(Boolean)
          .join(", ")}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom);
        }}
        className={`flex min-w-0 flex-1 cursor-default items-center gap-2 rounded-md px-2 py-1 text-left transition-[padding] duration-150 motion-reduce:transition-none ${
          row.pinnable ? "group-hover:pr-7 group-has-[:focus-visible]:pr-7" : ""
        }`}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          {logoPath && status !== "working" ? (
            <ProjectLogoIcon
              path={logoPath}
              className="size-4 rounded-sm"
              imageClassName="size-4"
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
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1">
            {row.pinned ? (
              <Pin
                aria-label={t("Pinned")}
                className="size-3 shrink-0 text-content/45"
                strokeWidth={1.75}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight">
              {row.title}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-content/45">
            {row.remote ? (
              <Internet
                aria-label={t("On another machine")}
                className="size-3 shrink-0"
                strokeWidth={1.75}
              />
            ) : null}
            <span className="min-w-0 truncate">{project}</span>
            <span className="flex shrink-0 items-center gap-1">
              <span aria-hidden="true">·</span>
              <HarnessIcon harness={row.harness} className="size-3 shrink-0" />
              <span>{agent}</span>
              {time ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{time}</span>
                </>
              ) : null}
            </span>
          </span>
        </span>
        {status ? (
          <span
            role="img"
            aria-label={STATUS_LABEL[status]}
            title={STATUS_LABEL[status]}
            className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
          />
        ) : null}
      </button>
      {row.pinnable ? (
        <button
          type="button"
          title={row.pinned ? t("Unpin session") : t("Pin session")}
          aria-label={row.pinned ? t("Unpin session") : t("Pin session")}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid group-has-[:focus-visible]:grid"
        >
          {row.pinned ? (
            <PinOff className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Pin className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      ) : null}
    </div>
  );
}
