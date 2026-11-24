import type { ReactNode, RefObject } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
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

const STATE_LABELS: Record<SessionRowStatusKind, string> = {
  failed: "Failed",
  retrying: "Retrying",
  interrupted: "Interrupted",
  input: "Needs approval",
  working: "Working",
  waiting: "Waiting",
  opening: "Loading sessions…",
  done: "Done",
  draft: "Draft",
  idle: "Idle",
};

type SessionRow = Extract<SessionListRow, { kind: "session" }>;
type GlobalRow = SessionRow | { kind: "heading"; key: string; label: string };

/** Preserve global history actions while sharing the sidebar's scroll owner. */
export function GlobalSessionListWindow({
  sessions,
  scrollRef,
  isActive,
  renderSession,
  view,
  stateOf,
}: {
  sessions: readonly SessionSummary[];
  scrollRef: RefObject<HTMLDivElement | null>;
  isActive: (session: SessionSummary) => boolean;
  renderSession: (session: SessionSummary, active: boolean) => ReactNode;
  view: GlobalSessionListView;
  stateOf: (session: SessionSummary) => SessionRowStatusKind;
}) {
  const t = useT();
  const labels = useProjectLabels();
  const ordered =
    view.sort === "oldest"
      ? [...sessions].sort(
          (a, b) => (a.lastActivityAt ?? a.updatedAt) - (b.lastActivityAt ?? b.updatedAt),
        )
      : sessions;
  const sessionRows: SessionRow[] = ordered.map((session) => ({
    kind: "session",
    key: JSON.stringify([session.cwd, session.id]),
    session,
    section: "ungrouped",
    depth: 0,
  }));
  let rows: GlobalRow[] = sessionRows;
  if (view.groupBy !== "none") {
    const groups = new Map<string, GlobalRow[]>();
    for (const row of sessionRows) {
      const cwd = isProjectlessCwd(row.session.cwd) ? "~" : row.session.cwd;
      const state = view.groupBy === "state" ? stateOf(row.session) : null;
      const key = state ?? projectKey(cwd);
      let group = groups.get(key);
      if (!group) {
        const label = state
          ? t(STATE_LABELS[state])
          : cwd === "~"
            ? t("No project")
            : projectDisplayNameFrom(cwd, labels);
        group = [{ kind: "heading", key: JSON.stringify([view.groupBy, key]), label }];
        groups.set(key, group);
      }
      group.push(row);
    }
    rows = [...groups.values()].flat();
  }
  const active = sessionRows.find((row) => isActive(row.session));
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
