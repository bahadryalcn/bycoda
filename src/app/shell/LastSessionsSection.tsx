import { AssistantManagedBadge } from "../../features/sessions/ui/AssistantManagedBadge";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Button } from "../../shared/ui/Button";
import { ContinuousList } from "../../shared/ui/ContinuousList";
import { ActionHost } from "../../shared/ui/ActionHost";
import { useMinuteNow } from "../../shared/hooks/useMinuteNow";
import { getLocale, useT } from "../../shared/i18n";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, CircleAlert, FolderOpen, Internet, PenLine } from "../../shared/ui/icons";
import { basename } from "../../platform/tauri/fs";
import { projectKey, projectName } from "../../shared/lib/paths";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import type { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { ExplorerMenu } from "../../features/files/ui/ExplorerMenu";
import {
  RAIL_SECTION_BLOCK,
  RAIL_SECTION_LABEL,
  SectionMenuButton,
  type RailSectionDrag,
} from "./useRailSections";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { useRecentSessions } from "../../features/sessions/hooks/useRecentSessions";
import { useUnsentComposerDraft } from "../../features/sessions/hooks/useUnsentComposerDraft";
import {
  buildRecentSessions,
  formatRelative,
  loadRecentSessionsPrefs,
  RECENT_SESSION_COUNTS,
  recentCountLabel,
  saveRecentSessionsPrefs,
  isProjectlessCwd,
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
  return { prefs, update, rows, hasRows: rows.length > 0, refresh };
}

const STATUS_LABEL: Record<RecentSessionStatus, string> = {
  retrying: "Retrying",
  failed: "Failed",
  interrupted: "Interrupted",
  working: "Working",
  input: "Needs input",
  done: "Done",
};

const STATUS_DOT: Record<RecentSessionStatus, string> = {
  retrying: "bg-warning",
  failed: "bg-danger",
  interrupted: "bg-warning",
  working: "working-dot bg-accent animate-pulse motion-reduce:animate-none",
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
  onOpenLastSessions,
  lastSessionsOpen = false,
  drag,
  onShownChange,
  listScopeKey,
  ...appearance
}: {
  source: RecentSessionsSource;
  /** `pathKey` of every project on the rail; sessions of any other folder are left out. */
  projectKeys: ReadonlySet<string>;
  enabled: boolean;
  activeSessionId?: string;
  searchActive: boolean;
  onOpenSession?: (sessionId: string, cwd: string, options?: { keepOpen?: boolean }) => void;
  onOpenProject: (path: string) => void;
  onOpenLastSessions?: () => void;
  lastSessionsOpen?: boolean;
  /** Lets the rail move this section by its header. */
  drag?: RailSectionDrag;
  /** Reports whether the section is on screen: it has nothing to show without sessions. */
  onShownChange?: (shown: boolean) => void;
  /** Optional owner scope for query-specific Last sessions viewports. */
  listScopeKey?: string;
} & Appearance) {
  const t = useT();
  const { prefs, update, rows, hasRows } = useLastSessionsRows({
    source,
    projectKeys,
    enabled,
  });
  useEffect(() => {
    onShownChange?.(true);
    return () => onShownChange?.(false);
  }, [onShownChange]);
  return (
    <div
      ref={drag?.setRef}
      className={RAIL_SECTION_BLOCK}
      data-collapsed={prefs.collapsed || undefined}
    >
      {/* One header surface: ActionHost paints hover and the open state for chevron, label and
          actions together, so the open list reads as a row, not as two pills. */}
      <ActionHost
        {...drag?.headerProps}
        selected={lastSessionsOpen}
        className="group min-h-(--ui-control-height-compact) gap-0 px-2"
      >
        {/* A direct, non-inset child: the host owns its fills, so an expanded section shows
            no separate chip (inset actions paint aria-expanded as an open menu). */}
        <Button
          variant="ghost"
          iconOnly
          size="sm"
          motion="none"
          type="button"
          data-no-drag
          label={t(prefs.collapsed ? "Expand" : "Collapse")}
          aria-expanded={!prefs.collapsed}
          onClick={() => update({ ...prefs, collapsed: !prefs.collapsed })}
        >
          <ChevronDown className={`icon-xs ${prefs.collapsed ? "-rotate-90" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          motion="none"
          type="button"
          data-no-drag
          tooltip={t("All sessions across your projects")}
          onClick={onOpenLastSessions}
          aria-current={lastSessionsOpen ? "page" : undefined}
          className={`min-w-0 flex-1 justify-start px-1 ${RAIL_SECTION_LABEL} ${
            lastSessionsOpen ? "text-content" : ""
          }`}
        >
          <span className="truncate">{t("Last sessions")}</span>
        </Button>
        {!prefs.collapsed && hasRows ? (
          <CountPicker count={prefs.count} onChange={(count) => update({ ...prefs, count })} />
        ) : null}
        {drag ? <SectionMenuButton label={t("Last sessions")} onOpen={drag.openMenu} /> : null}
      </ActionHost>
      {prefs.collapsed ? null : (
        <LastSessionsRows
          rows={rows}
          activeSessionId={activeSessionId}
          searchActive={searchActive}
          onOpenSession={onOpenSession}
          onOpenProject={onOpenProject}
          className={drag?.folded ? "hidden" : "flex"}
          listScopeKey={listScopeKey}
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
  className,
  listScopeKey,
  ...appearance
}: {
  rows: RecentSessionRow[];
  activeSessionId?: string;
  searchActive: boolean;
  onOpenSession?: (sessionId: string, cwd: string, options?: { keepOpen?: boolean }) => void;
  onOpenProject: (path: string) => void;
  className?: string;
  listScopeKey?: string;
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
        className={`flex min-h-0 flex-1 flex-col gap-px ${className ?? ""}`}
      >
        <ContinuousList
          className="flex-1 min-h-0 px-2"
          items={rows}
          itemKey={(row) => JSON.stringify([row.cwd, row.id])}
          stateKey={listScopeKey ?? "last-sessions:rail"}
          estimateSize={56}
          renderItem={(row) => (
            <SessionRow
              row={row}
              now={now}
              selected={!searchActive && row.id === activeSessionId}
              onOpen={() => onOpenSession?.(row.id, row.cwd)}
              onKeepOpen={() => onOpenSession?.(row.id, row.cwd, { keepOpen: true })}
              onOpenMenu={(x, y) => setMenu({ x, y, row })}
              {...appearance}
            />
          )}
        />
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
            ...(isProjectlessCwd(menuRow.cwd)
              ? []
              : [
                  {
                    kind: "item" as const,
                    id: "project",
                    get label() {
                      return t("Open project");
                    },
                  },
                ]),
          ]}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onOpenSession?.(menuRow.id, menuRow.cwd);
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
        tooltip={t("Sessions shown")}
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
  onOpenMenu: (x: number, y: number) => void;
} & Appearance) {
  const t = useT();
  const key = projectKey(row.cwd);
  const seed = projectName(row.cwd);
  const projectless = isProjectlessCwd(row.cwd);
  const project = projectless
    ? t("No project")
    : resolveTabGroupLabel(key, groupLabels, basename(row.cwd));
  const logoPath = resolveTabGroupLogo(key, groupLogos);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const agent = HARNESS_TITLE[row.harness];
  const model = row.model ? resolveModel(row.harness, row.model).name : "";
  const time = formatRelative(row.updatedAt, now);
  const status = row.status;
  // Text left unsent in another session's composer; the open session shows its own.
  const draft = useUnsentComposerDraft(row.id, !selected);
  const location = row.remote ? `${remoteProjectFor(row.cwd)?.cwd ?? row.cwd} (remote)` : row.cwd;
  const tooltip = [
    row.title,
    projectless ? project : `${project} · ${location}`,
    model ? `${agent} · ${model}` : agent,
    draft ? t("Draft") : "",
    status
      ? t(STATUS_LABEL[status])
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
    <ActionHost
      role="listitem"
      selected={selected}
      className="group relative flex min-w-0 items-center rounded-md"
      onContextMenu={openMenuAt}
    >
      {/* One 28px row on the rail grid, like the tool and project rows: a 14px project mark,
          the title, then quiet trailing state. Project and agent live in the tooltip and name. */}
      <Button
        variant="item"
        motion="none"
        type="button"
        tooltip={tooltip}
        selected={selected}
        aria-current={selected ? "true" : undefined}
        aria-label={[
          row.title,
          project,
          agent,
          draft ? t("Draft") : "",
          status ? t(STATUS_LABEL[status]) : time,
        ]
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
        className="flex min-w-0 flex-1 items-center gap-1.5"
      >
        <span className="grid icon-sm shrink-0 place-items-center" aria-hidden="true">
          {projectless ? (
            <FolderOpen className="icon-sm text-(--ui-text-secondary)" strokeWidth={1.75} />
          ) : logoPath && status !== "working" ? (
            <ProjectLogoIcon
              path={logoPath}
              className="icon-sm rounded-sm"
              imageClassName="icon-sm"
            />
          ) : (
            <ProjectMascot
              project={seed}
              color={color}
              name={resolveTabGroupMascot(key, groupMascots)}
              className="icon-sm"
              active={status === "working"}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-secondary leading-tight">{row.title}</span>
        <AssistantManagedBadge management={row.managedBy} compact local={!row.remote} />
        {draft ? (
          <PenLine
            aria-hidden="true"
            className="icon-xs shrink-0 text-(--ui-tone-warning-fg)"
            strokeWidth={1.75}
          />
        ) : null}
        {row.remote ? (
          <Internet
            aria-label={t("On another machine")}
            className="icon-xs shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
        ) : null}
        <HarnessIcon harness={row.harness} className="icon-xs shrink-0 @max-[200px]/rail:hidden" />
        {status === "interrupted" ? (
          <CircleAlert
            role="img"
            aria-label={t("Interrupted")}
            className="icon-xs shrink-0 text-(--ui-tone-warning-fg)"
            strokeWidth={1.75}
          />
        ) : status ? (
          <span
            role="img"
            aria-label={t(STATUS_LABEL[status])}
            title={t(STATUS_LABEL[status])}
            className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
          />
        ) : null}
        {time ? (
          <span className="shrink-0 text-ui-micro tabular-nums text-(--ui-text-secondary)">
            {time}
          </span>
        ) : null}
      </Button>
    </ActionHost>
  );
}
