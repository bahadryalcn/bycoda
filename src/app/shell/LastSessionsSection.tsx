import { surfaceAttributes } from "../../shared/ui/Surface";
import { StatusDot, type StatusDotProps } from "../../shared/ui/StatusDot";
import { Tooltip } from "../../shared/ui/Tooltip";
import { WorkingIndicator } from "../../shared/ui/WorkingIndicator";
import { Text } from "../../shared/ui/Text";
import { AssistantManagedBadge } from "../../features/sessions/ui/AssistantManagedBadge";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Button } from "../../shared/ui/Button";
import { ContinuousList } from "../../shared/ui/ContinuousList";
import { ActionHost } from "../../shared/ui/ActionHost";
import { useMinuteNow } from "../../shared/hooks/useMinuteNow";
import { useLocale, useT } from "../../shared/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  Clock,
  FolderOpen,
  Internet,
  PenLine,
} from "../../shared/ui/icons";
import { basename } from "../../platform/tauri/fs";
import { projectKey, projectName } from "../../shared/lib/paths";
import { useRemoteProject } from "../../features/connections/public/useRemoteProject";
import type { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { RAIL_SECTION_BLOCK, RailSectionHeader, type RailSectionDrag } from "./useRailSections";
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
import { resolveModelFromCatalog } from "../../features/sessions/model/models";
import { useModelCatalog } from "../../features/sessions/model/modelHooks";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  resolveTabGroupColor,
  resolveTabGroupLabel,
  useResolvedTabGroupLogo,
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
  const handleUpdate = (next: RecentSessionsPrefs) => {
    setPrefs(next);
    saveRecentSessionsPrefs(next);
  };
  return { prefs, update: handleUpdate, rows, hasRows: rows.length > 0, refresh };
}

const STATUS_LABEL: Record<RecentSessionStatus, string> = {
  retrying: "Retrying",
  failed: "Failed",
  interrupted: "Interrupted",
  working: "Working",
  input: "Needs input",
  done: "Done",
};

const STATUS_DOT: Record<RecentSessionStatus, StatusDotProps["tone"]> = {
  retrying: "warning",
  failed: "danger",
  interrupted: "warning",
  working: "accent",
  input: "warning",
  done: "success",
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
      <RailSectionHeader
        label={t("Last sessions")}
        selected={lastSessionsOpen}
        drag={drag}
        icon={<Clock className="icon-sm" />}
        collapsed={prefs.collapsed}
        onToggleCollapsed={() => update({ ...prefs, collapsed: !prefs.collapsed })}
        onLabelClick={onOpenLastSessions}
        actions={
          !prefs.collapsed && hasRows ? (
            <CountPicker count={prefs.count} onChange={(count) => update({ ...prefs, count })} />
          ) : undefined
        }
      />
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

/** Navigation-only recent rows, shared by the rail section and compact rail popover. */
export function LastSessionsRows({
  rows,
  activeSessionId,
  searchActive,
  onOpenSession,
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
  const now = useMinuteNow();

  return (
    <>
      <div
        role="list"
        aria-label={t("Last sessions")}
        className={`flex min-h-0 flex-1 flex-col gap-0 ${className ?? ""}`}
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
              {...appearance}
            />
          )}
        />
      </div>
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
} & Appearance) {
  const t = useT();
  const key = projectKey(row.cwd);
  const seed = projectName(row.cwd);
  const projectless = isProjectlessCwd(row.cwd);
  const project = projectless
    ? t("No project")
    : resolveTabGroupLabel(key, groupLabels, basename(row.cwd));
  const logoPath = useResolvedTabGroupLogo(key, groupLogos);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const agent = HARNESS_TITLE[row.harness];
  const catalog = useModelCatalog(row.harness);
  const model = row.model
    ? resolveModelFromCatalog(catalog.resolution!, row.harness, row.model).name
    : "";
  const time = formatRelative(row.updatedAt, now);
  const status = row.status;
  // Text left unsent in another session's composer; the open session shows its own.
  const draft = useUnsentComposerDraft(row.id, !selected);
  const remoteProject = useRemoteProject(row.remote ? row.cwd : "");
  const locale = useLocale();
  const location = row.remote ? `${remoteProject?.cwd ?? row.cwd} (remote)` : row.cwd;
  const tooltip = [
    row.title,
    projectless ? project : `${project} · ${location}`,
    model ? `${agent} · ${model}` : agent,
    draft ? t("Draft") : "",
    status
      ? t(STATUS_LABEL[status])
      : time && `Last activity ${new Date(row.updatedAt).toLocaleString(locale)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <ActionHost
      role="listitem"
      selected={selected}
      {...surfaceAttributes({ radius: "row" }, "group relative flex min-w-0 items-center")}
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
        className="flex min-w-0 flex-1 items-center gap-1.5"
      >
        <span className="grid icon-sm shrink-0 place-items-center" aria-hidden="true">
          {projectless ? (
            <FolderOpen className="icon-sm" tone="secondary" strokeWidth={1.75} />
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
        <Text truncate size="secondary" tone="inherit" leading="tight" className="min-w-0 flex-1">
          {row.title}
        </Text>
        <AssistantManagedBadge management={row.managedBy} compact local={!row.remote} />
        {draft ? (
          <PenLine
            aria-hidden="true"
            className="icon-xs shrink-0"
            tone="warning"
            strokeWidth={1.75}
          />
        ) : null}
        {row.remote ? (
          <Internet
            aria-label={t("On another machine")}
            className="icon-xs shrink-0"
            tone="secondary"
            strokeWidth={1.75}
          />
        ) : null}
        <HarnessIcon harness={row.harness} className="icon-xs shrink-0 @max-[200px]/rail:hidden" />
        {status === "interrupted" ? (
          <CircleAlert
            role="img"
            aria-label={t("Interrupted")}
            className="icon-xs shrink-0"
            tone="warning"
            strokeWidth={1.75}
          />
        ) : status ? (
          <Tooltip label={t(STATUS_LABEL[status])}>
            {status === "working" ? (
              <span role="img" aria-label={t(STATUS_LABEL[status])}>
                <WorkingIndicator variant="dot" />
              </span>
            ) : (
              <StatusDot label={t(STATUS_LABEL[status])} tone={STATUS_DOT[status]} />
            )}
          </Tooltip>
        ) : null}
        {time ? (
          <Text size="micro" tone="secondary" className="shrink-0 tabular-nums">
            {time}
          </Text>
        ) : null}
      </Button>
    </ActionHost>
  );
}
