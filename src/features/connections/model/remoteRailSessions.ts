import type { LiveAgent, LiveSessionInfo } from "../../sessions";
import { sessionDisplayTitle } from "../../sessions/public/session";
import { wakeSourceWait, type SessionWait } from "../../sessions/public/sessionWait";
import { sameProjectPath } from "../../projects/public/recents";
import type { HostSessionSummary } from "./protocol";
import type { RemoteCreateIntent } from "./remoteCreateIntent";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";

/** A host session of a remote project on the rail, as its machine last listed it.
 * `fresh` is false while only the cached list is known, whose status is not trusted. */
export type RemoteRailSession = {
  project: string;
  session: HostSessionSummary;
  fresh?: boolean;
};

/** Each project's listed sessions, cached or fresh. Delegated advisors and subagents
 * belong to their parent's activity panel, so no rail, list or recovery sees them. */
export function railSessions(
  lists: ReadonlyMap<string, { list: readonly HostSessionSummary[]; fresh: boolean }>,
): RemoteRailSession[] {
  return [...lists].flatMap(([project, { list, fresh }]) =>
    list.filter(isUserConversation).map((session) => ({ project, session, fresh })),
  );
}

/** Host sessions no open tab has loaded; a loaded one is already in the app's session state.
 * While a tab creates its host session (`creating`), the host lists that session
 * before the tab is bound to it: any session of that project the create did not
 * know about is the tab's own and is not offered as unopened. */
export function unopenedRemoteSessions(
  listed: readonly RemoteRailSession[],
  loadedHostIds: ReadonlySet<string>,
  creating: readonly Pick<RemoteCreateIntent, "project" | "knownSessionIds">[] = [],
): RemoteRailSession[] {
  return listed.filter(
    ({ project, session }) =>
      !session.archived &&
      !session.draft &&
      !loadedHostIds.has(session.id) &&
      !creating.some(
        (intent) =>
          sameProjectPath(intent.project, project) && !intent.knownSessionIds.has(session.id),
      ),
  );
}

/** What "Last sessions" shows for host sessions that are not open here. */
export function remoteLiveSessionInfos(listed: readonly RemoteRailSession[]): LiveSessionInfo[] {
  return listed.map(({ project, session }) => ({
    id: session.id,
    cwd: project,
    title: session.title,
    harness: session.harness,
    model: session.model ?? "",
    status:
      session.issue ??
      (session.needsInput
        ? "input"
        : session.status === "running"
          ? "working"
          : session.status === "interrupted"
            ? "interrupted"
            : undefined),
    activityAt: session.lastActivityAt ?? session.updatedAt,
  }));
}

/**
 * "Waiting" for a listed host session: its Host-run turn is held open by background
 * work, delegated children still run, or an idle session has a pending wake source.
 * Issues, interruptions and needs-input outrank it; a plain running turn is working.
 */
export function remoteSessionWait(
  session: Pick<HostSessionSummary, "status" | "issue" | "needsInput" | "waiting" | "wakeSources">,
  now = Date.now(),
): SessionWait | null {
  if (session.issue || session.needsInput || session.status === "interrupted") return null;
  if (session.status === "running") return session.waiting ?? null;
  return session.waiting ?? wakeSourceWait(session.wakeSources, now);
}

/** The rail's working card for host sessions that run without an open tab
 * here, and those that finished since, until they are looked at. */
export function remoteLiveAgents(
  listed: readonly RemoteRailSession[],
  unseenFinishedIds: ReadonlySet<string> = new Set(),
  now = Date.now(),
): LiveAgent[] {
  return listed
    .map((row) => ({ ...row, wait: remoteSessionWait(row.session, now) }))
    .filter(
      ({ session, wait }) =>
        session.issue === "failed" ||
        session.needsInput ||
        session.status === "running" ||
        wait !== null ||
        unseenFinishedIds.has(session.id),
    )
    .map(({ project, session, wait }) => {
      const done =
        !session.needsInput &&
        session.status !== "running" &&
        !wait &&
        (session.issue === "failed" || unseenFinishedIds.has(session.id));
      return {
        id: session.id,
        cwd: project,
        title: sessionDisplayTitle(session.title, session.harness),
        harness: session.harness,
        issue: session.issue,
        activity: session.issue
          ? session.issue === "retrying"
            ? "Retrying"
            : "Failed"
          : session.needsInput
            ? "Needs input"
            : done
              ? "Done"
              : "Working",
        needsApproval: !!session.needsInput,
        done,
        ...(wait ? { waiting: wait } : {}),
      };
    });
}

/** Host sessions that stopped running while no tab here had them loaded, until
 * they are opened. A cached (not fresh) entry keeps its last known state, so a
 * list that is only being reloaded does not read as a finished turn. */
export function nextRemoteUnseenFinished({
  listed,
  previousRunningIds,
  previousUnseenIds,
  loadedHostIds,
  focusedHostId,
}: {
  listed: readonly RemoteRailSession[];
  previousRunningIds: ReadonlySet<string>;
  previousUnseenIds: ReadonlySet<string>;
  /** Host sessions open here: their own tab shows when they finish. */
  loadedHostIds: ReadonlySet<string>;
  focusedHostId?: string;
}): { runningIds: Set<string>; unseenIds: Set<string> } {
  const listedIds = new Set<string>();
  const runningIds = new Set<string>();
  for (const { session, fresh } of listed) {
    if (session.archived || session.draft) continue;
    listedIds.add(session.id);
    if (fresh ? session.status === "running" : previousRunningIds.has(session.id))
      runningIds.add(session.id);
  }
  const unseenIds = new Set<string>();
  for (const id of previousUnseenIds) if (listedIds.has(id)) unseenIds.add(id);
  for (const id of previousRunningIds)
    if (listedIds.has(id) && !runningIds.has(id)) unseenIds.add(id);
  for (const id of runningIds) unseenIds.delete(id);
  for (const id of loadedHostIds) unseenIds.delete(id);
  if (focusedHostId) unseenIds.delete(focusedHostId);
  return { runningIds, unseenIds };
}
