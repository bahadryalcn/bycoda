import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { compareSessionSummaries } from "../../features/sessions/model/compareSessionSummaries";
import type { RemoteRailSession } from "../../features/connections/model/remoteRailSessions";
import type { ProjectLinks } from "../../features/projects/model/projectRepositories";
import { isRemoteProjectPath, sameProjectPath } from "../../features/projects/model/recents";
import { isListedConversation } from "../../shared/model/host-contracts/delegation";
import { pathKey } from "../../shared/lib/paths";
import type { SessionListRow } from "./sessionListWindow";
import { remoteSessionSummary } from "./sidebarSessionCollections";

/**
 * A project that is one repository on several machines lists the sessions of
 * all its copies together. Each machine still owns its sessions: the open
 * copy's list keeps every action, and the other copies' sessions join it as
 * rows that open on their own machine.
 */

/** The other copies of the open project, leaving out the ones the user has locked away. */
export function otherProjectCopies(
  links: ProjectLinks,
  cwd: string,
  isLocked: (path: string) => boolean,
): string[] {
  if (!cwd || cwd === "~") return [];
  return links.copiesOf(cwd).filter((copy) => !sameProjectPath(copy, cwd) && !isLocked(copy));
}

/** This computer's copy among them, whose sessions come from the local store. */
export function localProjectCopy(copies: readonly string[]): string | undefined {
  return copies.find((copy) => !isRemoteProjectPath(copy));
}

export type CopySessions = {
  sessions: SessionSummary[];
  /** Copies whose machine has not answered: their rows are the last known list. */
  stale: ReadonlySet<string>;
};

/**
 * The other copies' conversations. A remote copy's come from the list its
 * machine last gave the rail, a local copy's from this computer's store.
 */
export function copySessions(
  copies: readonly string[],
  remoteRows: readonly RemoteRailSession[],
  localRows: readonly SessionSummary[],
  showBackground = false,
): CopySessions {
  const sessions: SessionSummary[] = [];
  const stale = new Set<string>();
  const seen = new Set<string>();
  const add = (session: SessionSummary) => {
    const key = copySessionKey(session);
    if (seen.has(key)) return;
    seen.add(key);
    sessions.push(session);
  };
  for (const copy of copies) {
    if (!isRemoteProjectPath(copy)) {
      for (const row of localRows) {
        if (
          sameProjectPath(row.cwd, copy) &&
          isListedConversation(row, showBackground) &&
          !row.orchestrationLeadId &&
          !row.draft
        )
          add(row);
      }
      continue;
    }
    for (const { project, session, fresh } of remoteRows) {
      if (
        !sameProjectPath(project, copy) ||
        session.draft ||
        !isListedConversation(session, showBackground)
      )
        continue;
      if (!fresh) stale.add(pathKey(copy));
      add(remoteSessionSummary(session, copy));
    }
  }
  return { sessions: sessions.sort(compareSessionSummaries), stale };
}

export function copySessionKey(session: Pick<SessionSummary, "cwd" | "id">): string {
  return `copy:${pathKey(session.cwd)}\0${session.id}`;
}

export function isCopyRow(row: SessionListRow): boolean {
  return row.kind === "session" && row.section === "copy";
}

/**
 * Places the other copies' sessions among the list's loose rows by recency.
 * Pins, reminders, folders and the settled shelf belong to the open copy and
 * keep their rows; a copy's session goes after the last loose row that is not
 * older than it, which leaves the open copy's own order untouched.
 */
export function mergeCopyRows(
  rows: readonly SessionListRow[],
  copies: readonly SessionSummary[],
): SessionListRow[] {
  if (copies.length === 0) return rows as SessionListRow[];
  const loose = (row: SessionListRow) => row.kind === "session" && row.section === "ungrouped";
  const first = rows.findIndex(loose);
  let end = first;
  if (first < 0) {
    // No loose rows: the copies go where they would be, above the settled shelf.
    const shelf = rows.findIndex((row) => row.kind === "group" && row.entry.kind === "settled");
    end = shelf < 0 ? rows.length : shelf;
  } else {
    while (end < rows.length && loose(rows[end])) end += 1;
  }
  const start = first < 0 ? end : first;
  const merged: SessionListRow[] = rows.slice(start, end);
  for (const session of [...copies].sort(compareSessionSummaries)) {
    let at = 0;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const row = merged[index];
      if (row.kind !== "session") continue;
      const newerOrEqual = isCopyRow(row)
        ? true
        : compareSessionSummaries(
            { ...row.session, pinned: false },
            { ...session, pinned: false },
          ) <= 0;
      if (newerOrEqual) {
        at = index + 1;
        break;
      }
    }
    merged.splice(at, 0, {
      kind: "session",
      key: copySessionKey(session),
      session,
      section: "copy",
      depth: 0,
    });
  }
  return [...rows.slice(0, start), ...merged, ...rows.slice(end)];
}
