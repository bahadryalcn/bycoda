import { useEffect, type ReactNode, type RefObject } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { CatalogSegmentKey } from "../../features/sessions/data/sessionCatalog";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { globalSessionKey } from "../../features/sessions/model/globalRecentSessions";
import {
  globalSectionCollapseKey,
  PROJECTLESS_GROUP_KEY,
  visibleGlobalSections,
  type GlobalSessionSection,
} from "../../features/sessions/model/globalSessionSections";
import type { GlobalSessionListView } from "../../features/sessions/model/sessionFilters";
import type { SessionRowStatusKind } from "../../features/sessions/ui/SessionRowStatus";
import {
  projectDisplayNameFrom,
  useProjectLabels,
} from "../../features/projects/model/projectNames";
import { useT } from "../../shared/i18n";
import { FolderOpen } from "../../shared/ui/icons";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { SessionGroupListRow } from "./SessionFolderListRows";
import { FolderRow } from "./SessionFolderRows";
import {
  SessionListWindow,
  type SessionListRow,
  type SessionListVirtualProps,
} from "./sessionListWindow";
import { SessionProjectIcon } from "./useSessionProjectAppearance";
import styles from "./Sidebar.module.css";

/**
 * The last row of a paged segment. The list is windowed, so it mounts only near the viewport:
 * mounting (and every return to idle while still mounted) fetches the next page.
 */
function SegmentLoaderRow({
  virtual,
  segment,
  status,
  onLoad,
}: {
  virtual: SessionListVirtualProps;
  segment: CatalogSegmentKey;
  status: "idle" | "loading" | "done" | "error";
  onLoad: (segment: CatalogSegmentKey) => void;
}) {
  const t = useT();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- the windowed list mounts this row as it scrolls into view; that visibility pulls the next page from the native store
  useEffect(() => {
    if (status === "idle") onLoad(segment);
  }, [status, segment, onLoad]);
  return (
    <li {...virtual} data-session-list-loader={segment}>
      <div className="flex min-h-8 items-center justify-center px-2.5">
        {status === "error" ? (
          <Button variant="ghost" size="sm" onClick={() => onLoad(segment)}>
            {t("Retry")}
          </Button>
        ) : (
          <Spinner size="xs" label={t("Loading sessions…")} />
        )}
      </div>
    </li>
  );
}

const stateLabels = (t: ReturnType<typeof useT>): Record<SessionRowStatusKind, string> => ({
  failed: t("Failed"),
  retrying: t("Retrying"),
  interrupted: t("Interrupted"),
  input: t("Needs approval"),
  working: t("Working"),
  waiting: t("Waiting"),
  opening: t("Loading sessions…"),
  done: t("Done"),
  draft: t("Draft"),
  idle: t("Idle"),
});

type SessionRow = Extract<SessionListRow, { kind: "session" }>;
type GroupRow = Extract<SessionListRow, { kind: "group" }>;
type ProjectRow = {
  kind: "heading";
  key: string;
  label: string;
  /** Set on a collapsible project header; a state heading has none. */
  project?: {
    cwd: string;
    collapseKey: string;
    collapsed: boolean;
    sessions: SessionSummary[];
    total: number;
  };
  /** Set on the row that loads a segment's next page once it scrolls into view. */
  loader?: CatalogSegmentKey;
};

/** Paged history behind the list: which segments have more rows, and how to fetch them. */
export type GlobalSessionPaging = {
  segment: (key: CatalogSegmentKey) => { status: "idle" | "loading" | "done" | "error" };
  loadMore: (key: CatalogSegmentKey) => void;
};
type GlobalRow = SessionRow | GroupRow | ProjectRow;

/** Every session row the list shows, in order: the keyboard and selection order. */
export function globalSectionNavigationKeys(
  sections: readonly GlobalSessionSection[],
  view: GlobalSessionListView,
  isCollapsed: (key: string) => boolean,
  expandCollapsed: boolean,
): string[] {
  return visibleGlobalSections(sections, view, isCollapsed, expandCollapsed).flatMap(({ shown }) =>
    shown.map(globalSessionKey),
  );
}

/**
 * Last sessions across projects, laid out like a project list: Pinned, the view's groups (projects
 * fold like folders, No project last), then the Settled shelf. Shares the sidebar's scroll owner.
 */
export function GlobalSessionListWindow({
  sections,
  scrollRef,
  isActive,
  renderSession,
  view,
  isCollapsed,
  expandCollapsed,
  onToggleCollapsed,
  busyIds,
  doneIds,
  approvalIds,
  paging,
  onlySettled = false,
  onArchiveSettled,
  onDeleteSettled,
}: {
  sections: readonly GlobalSessionSection[];
  scrollRef: RefObject<HTMLDivElement | null>;
  isActive: (session: SessionSummary) => boolean;
  renderSession: (session: SessionSummary, active: boolean, inPinnedSection: boolean) => ReactNode;
  view: GlobalSessionListView;
  isCollapsed: (key: string) => boolean;
  /** Search shows the matches inside collapsed groups too. */
  expandCollapsed: boolean;
  onToggleCollapsed: (key: string) => void;
  busyIds: ReadonlySet<string>;
  doneIds: ReadonlySet<string>;
  approvalIds: ReadonlySet<string>;
  /** Absent for a fully loaded list (tests, fixtures). */
  paging?: GlobalSessionPaging;
  /** The Settled filter is on: every listed session is settled. */
  onlySettled?: boolean;
  /** The Settled shelf's menu: acts on the settled sessions the shelf has loaded. */
  onArchiveSettled?: (sessions: readonly SessionSummary[]) => void;
  /** Deletes after the owner's own confirmation, which names the exact count. */
  onDeleteSettled?: (sessions: readonly SessionSummary[]) => void;
}) {
  const t = useT();
  const labels = useProjectLabels();
  const rows: GlobalRow[] = [];
  const pushLoader = (segment: CatalogSegmentKey) => {
    if (paging && paging.segment(segment).status !== "done")
      rows.push({ kind: "heading", key: `loader:${segment}`, label: "", loader: segment });
  };
  const visible = visibleGlobalSections(sections, view, isCollapsed, expandCollapsed);
  let lastGroup = -1;
  visible.forEach(({ section }, index) => {
    if (section.kind === "group") lastGroup = index;
  });
  visible.forEach(({ section, collapsed, shown }, index) => {
    // A counted project whose pages ended without a listable row has nothing to show.
    if (
      section.kind === "group" &&
      !section.sessions.length &&
      (!paging || onlySettled || paging.segment(`project:${section.key}`).status === "done")
    )
      return;
    const groupSection = section.kind === "group" ? undefined : section.kind;
    if (section.kind !== "group") {
      rows.push({
        kind: "group",
        key: `group:${section.kind}`,
        entry:
          section.kind === "pinned"
            ? { kind: "pinned", collapsed, sessions: section.sessions, folders: [] }
            : { kind: "settled", collapsed, sessions: section.sessions },
      });
    } else if (view.groupBy === "project") {
      const projectless = section.key === PROJECTLESS_GROUP_KEY;
      rows.push({
        kind: "heading",
        key: JSON.stringify([view.groupBy, section.key]),
        label: projectless
          ? t("No project")
          : projectDisplayNameFrom(section.cwd, labels),
        project: {
          cwd: projectless ? "" : section.cwd,
          collapseKey: globalSectionCollapseKey(section, view)!,
          collapsed,
          sessions: section.sessions,
          total: section.total,
        },
      });
    } else if (view.groupBy === "state") {
      rows.push({
        kind: "heading",
        key: JSON.stringify([view.groupBy, section.key]),
        label: stateLabels(t)[section.key as SessionRowStatusKind],
      });
    }
    for (const session of shown)
      rows.push({
        kind: "session",
        key: globalSessionKey(session),
        session,
        section: groupSection ?? "ungrouped",
        depth: 0,
        groupSection,
      });
    if (collapsed || onlySettled) return;
    // Each open project and the Settled shelf page on their own; other views share one list.
    if (section.kind === "settled") pushLoader("settled");
    else if (section.kind === "group" && view.groupBy === "project")
      pushLoader(`project:${section.key}`);
    else if (section.kind === "group" && index === lastGroup) pushLoader("flat");
  });
  // The Settled filter lists only settled sessions: they all come from the shelf's segment.
  if (onlySettled) pushLoader("settled");
  else if (paging && view.groupBy !== "project" && lastGroup < 0) pushLoader("flat");
  const settledTotal = sections.find((section) => section.kind === "settled")?.total;
  const active = rows.find((row) => row.kind === "session" && isActive(row.session));
  return (
    <SessionListWindow
      rows={rows}
      scrollRef={scrollRef}
      activeKey={null}
      activeRowKey={active?.key ?? null}
      renderRow={(row, virtual) => {
        if (row.kind === "session")
          return (
            <li {...virtual} key={row.key}>
              {renderSession(
                row.session,
                isActive(row.session),
                row.groupSection === "pinned",
              )}
            </li>
          );
        if (row.kind === "group") {
          const key = row.entry.kind === "pinned" ? "pinned" : "settled";
          return (
            <SessionGroupListRow
              key={row.key}
              entry={row.entry as Extract<GroupRow["entry"], { kind: "pinned" | "settled" }>}
              virtual={virtual}
              expanded={!row.entry.collapsed}
              busyIds={busyIds}
              doneIds={doneIds}
              approvalIds={approvalIds}
              reminderColor=""
              renderName={(name) => name}
              total={key === "settled" ? settledTotal : undefined}
              onArchiveAll={
                key === "settled" && onArchiveSettled
                  ? () => onArchiveSettled(row.entry.sessions)
                  : undefined
              }
              onDeleteAll={
                key === "settled" && onDeleteSettled
                  ? () => onDeleteSettled(row.entry.sessions)
                  : undefined
              }
              onToggle={() => onToggleCollapsed(key)}
            />
          );
        }
        if (row.loader && paging)
          return (
            <SegmentLoaderRow
              key={row.key}
              virtual={virtual}
              segment={row.loader}
              status={paging.segment(row.loader).status}
              onLoad={paging.loadMore}
            />
          );
        const project = row.project;
        if (!project)
          return (
            <li {...virtual} key={row.key}>
              <SectionLabel className="px-2.5 py-2">{row.label}</SectionLabel>
            </li>
          );
        return (
          <li
            {...virtual}
            key={row.key}
            data-global-project-group={project.collapseKey}
            data-section-divided=""
            data-section-collapsed={project.collapsed ? "" : undefined}
            className={`${virtual.className ?? "relative"} ${styles.folder}`}
            style={virtual.style}
          >
            <div {...surfaceAttributes({ radius: "row" }, "overflow-hidden")}>
              <FolderRow
                folder={{ name: row.label }}
                sessions={project.sessions}
                total={project.total}
                expanded={!project.collapsed}
                busy={project.sessions.some((session) => busyIds.has(session.id))}
                done={project.sessions.some((session) => doneIds.has(session.id))}
                needsApproval={project.sessions.some((session) => approvalIds.has(session.id))}
                groupIcon={
                  project.cwd ? (
                    <SessionProjectIcon cwd={project.cwd} />
                  ) : (
                    <FolderOpen className="icon-sm" strokeWidth={1.75} />
                  )
                }
                onToggle={() => onToggleCollapsed(project.collapseKey)}
              />
            </div>
          </li>
        );
      }}
    />
  );
}
