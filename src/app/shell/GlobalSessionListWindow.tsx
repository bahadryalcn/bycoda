import type { ReactNode, RefObject } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { SessionListWindow, type SessionListRow } from "./sessionListWindow";

/** Preserve global history actions while sharing the sidebar's scroll owner. */
export function GlobalSessionListWindow({
  sessions,
  scrollRef,
  isActive,
  renderSession,
}: {
  sessions: readonly SessionSummary[];
  scrollRef: RefObject<HTMLDivElement | null>;
  isActive: (session: SessionSummary) => boolean;
  renderSession: (session: SessionSummary, active: boolean) => ReactNode;
}) {
  const rows: SessionListRow[] = sessions.map((session) => ({
    kind: "session",
    key: JSON.stringify([session.cwd, session.id]),
    session,
    section: "ungrouped",
    depth: 0,
  }));
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
        ) : null
      }
    />
  );
}
