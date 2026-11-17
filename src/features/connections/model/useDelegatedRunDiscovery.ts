import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { featureHost } from "./hostFeatureClient";
import { loadRemoteSession, remoteRequest } from "./connections";
import { getSessions, setSessions, useSession } from "../../sessions/public/sessionsStore";
import { discoverDelegatedRuns, type DelegatedDiscoveryPort } from "./delegatedRunDiscovery";
import type { HostSession, HostSessionSummary } from "./protocol";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { classifyRemoteError, isConnectionFailure } from "./remoteFailure";
import { captureRemoteSessionActions } from "./remoteSessionActions";

/** A busy or unreachable machine is not this background check's failure to
 * show: the next poll retries it, and the machine's connection notice explains
 * a lost connection. Only a failure of the check itself is reported. */
export function delegatedDiscoveryFailure(error: unknown): string | undefined {
  const failure = classifyRemoteError(error);
  if (failure.kind === "temporary" || isConnectionFailure(failure)) return undefined;
  return failure.message;
}

/** The last list answer per Host project and parent. Discovery polls every few seconds;
 * with the etag the Host answers "unchanged" instead of scanning the project again. */
const listed = new Map<string, { etag: string; sessions: HostSessionSummary[] }>();
type ListAnswer =
  | HostSessionSummary[]
  | { unchanged: true; etag: string }
  | { etag: string; sessions: HostSessionSummary[] };

export async function listDelegatedRunSummaries(
  machineId: string,
  projectId: string,
  parentSessionId: string,
): Promise<HostSessionSummary[]> {
  const key = `${machineId}\0${projectId}\0${parentSessionId}`;
  const previous = listed.get(key);
  const answer = await remoteRequest<ListAnswer>(machineId, "sessions.list", {
    projectId,
    parentSessionId,
    known: previous?.etag ?? "",
  });
  // An older Host ignores `known` and answers with the plain list.
  if (Array.isArray(answer)) return answer;
  if ("unchanged" in answer) return previous?.sessions ?? [];
  listed.delete(key);
  listed.set(key, { etag: answer.etag, sessions: answer.sessions });
  while (listed.size > 32) listed.delete(listed.keys().next().value!);
  return answer.sessions;
}

const port: DelegatedDiscoveryPort = {
  host: (cwd) => featureHost(cwd, "sessions.desktop"),
  list: listDelegatedRunSummaries,
  read: (machineId, id, known) => loadRemoteSession(machineId, id, known),
};

export function useDelegatedRunDiscovery(parentId: string, visible: boolean) {
  const parent = useSession(parentId);
  const [failure, setFailure] = useState<{ parentId: string; message: string }>();
  const [retry, setRetry] = useState(0);
  const cwd = parent?.cwd;
  const eligible = !!parent && isUserConversation(parent);
  useEffect(() => {
    if (!isTauri() || !visible || !eligible || !cwd || !parent) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = new Map<string, HostSession>();
    const nestedListed = new Set<string>();
    const report = (error: unknown) => {
      const message = delegatedDiscoveryFailure(error);
      if (current && message !== undefined) setFailure({ parentId, message });
    };
    const load = async () => {
      try {
        const before = new Map(getSessions().map((session) => [session.id, session]));
        const snapshot = before.get(parentId);
        if (!snapshot) return;
        const children = await discoverDelegatedRuns(
          snapshot,
          port,
          known,
          () => current,
          nestedListed,
        );
        if (!current) return;
        setSessions((sessions) => {
          const present = new Map(sessions.map((session) => [session.id, session]));
          if (present.get(parentId)?.cwd !== snapshot.cwd) return sessions;
          // A sheet's live owner publishes its own snapshots. A background poll
          // must neither roll those back nor resurrect a child removed while
          // the rest of this parent's children were being read.
          const updates = new Map(
            children
              .filter(
                (child) =>
                  before.get(child.id) === present.get(child.id) &&
                  !captureRemoteSessionActions(child.id)?.current(),
              )
              .map((child) => [child.id, child]),
          );
          if (!updates.size) return sessions;
          const next = sessions.map((session) => {
            const update = updates.get(session.id);
            updates.delete(session.id);
            return update ? { ...session, ...update } : session;
          });
          return [...next, ...updates.values()];
        });
        setFailure(undefined);
      } catch (error) {
        report(error);
      } finally {
        if (current)
          timer = setTimeout(() => {
            load().catch(report);
          }, 5_000);
      }
    };
    load().catch(report);
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [parentId, cwd, visible, eligible, retry]);
  return {
    error: failure?.parentId === parentId ? failure.message : undefined,
    retry: () => setRetry((value) => value + 1),
  };
}
