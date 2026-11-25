import type { ReactNode, RefObject } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { globalSessionKey } from "../../features/sessions/model/globalRecentSessions";
import { isProjectlessCwd } from "../../features/sessions/model/recentSessions";
import type { GlobalSessionListView } from "../../features/sessions/model/sessionFilters";
import type { SessionRowStatusKind } from "../../features/sessions/ui/SessionRowStatus";
import {
  projectDisplayNameFrom,
  useProjectLabels,
} from "../../features/projects/model/projectNames";
import { useT } from "../../shared/i18n";
import { projectKey } from "../../shared/lib/paths";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { SessionListWindow, type SessionListRow } from "./sessionListWindow";

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
type GlobalRow = SessionRow | { kind: "heading"; key: string; label: string };

export function groupGlobalSessions(
  sessions: readonly SessionSummary[],
  view: GlobalSessionListView,
  stateOf: (session: SessionSummary) => SessionRowStatusKind,
) {
  const ordered =
    view.sort === "oldest"
      ? [...sessions].sort(
          (a, b) => (a.lastActivityAt ?? a.updatedAt) - (b.lastActivityAt ?? b.updatedAt),
        )
      : sessions;
  if (view.groupBy === "none") return new Map([["", ordered]]);
  const groups = new Map<string, SessionSummary[]>();
  for (const session of ordered) {
    const key =
      view.groupBy === "state"
        ? stateOf(session)
        : isProjectlessCwd(session.cwd)
          ? "~"
          : projectKey(session.cwd);
    const group = groups.get(key);
    if (group) group.push(session);
    else groups.set(key, [session]);
  }
  return groups;
}

/** Preserve global history actions while sharing the sidebar's scroll owner. */
export function GlobalSessionListWindow({
  groups,
  scrollRef,
  isActive,
  renderSession,
  view,
}: {
  groups: ReadonlyMap<string, readonly SessionSummary[]>;
  scrollRef: RefObject<HTMLDivElement | null>;
  isActive: (session: SessionSummary) => boolean;
  renderSession: (session: SessionSummary, active: boolean) => ReactNode;
  view: GlobalSessionListView;
}) {
  const t = useT();
  const labels = useProjectLabels();
  const rows: GlobalRow[] = [];
  for (const [key, sessions] of groups) {
    if (view.groupBy !== "none" && sessions.length) {
      const label =
        view.groupBy === "state"
          ? stateLabels(t)[key as SessionRowStatusKind]
          : key === "~"
            ? t("No project")
            : projectDisplayNameFrom(sessions[0].cwd, labels);
      rows.push({ kind: "heading", key: JSON.stringify([view.groupBy, key]), label });
    }
    for (const session of sessions)
      rows.push({
        kind: "session",
        key: globalSessionKey(session),
        session,
        section: "ungrouped",
        depth: 0,
      });
  }
  const active = rows.find((row) => row.kind === "session" && isActive(row.session));
  return (
    <SessionListWindow
      rows={rows}
      scrollRef={scrollRef}
      activeKey={null}
      activeRowKey={active?.key ?? null}
      renderRow={(row, virtual) =>
        row.kind === "session" ? (
          <li {...virtual} key={row.key}>
            {renderSession(row.session, isActive(row.session))}
          </li>
        ) : (
          <li {...virtual} key={row.key}>
            <SectionLabel className="px-2.5 py-2">{row.label}</SectionLabel>
          </li>
        )
      }
    />
  );
}
