import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { featureHost } from "./hostFeatureClient";
import { loadRemoteSession, remoteRequest } from "./connections";
import { getSessions, setSessions, useSession } from "../../sessions/public/sessionsStore";
import { discoverDelegatedRuns, type DelegatedDiscoveryPort } from "./delegatedRunDiscovery";
import type { HostSession, HostSessionSummary } from "./protocol";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { classifyRemoteError, isConnectionFailure } from "./remoteFailure";

/** A busy or unreachable machine is not this background check's failure to
 * show: the next poll retries it, and the machine's connection notice explains
 * a lost connection. Only a failure of the check itself is reported. */
export function delegatedDiscoveryFailure(error: unknown): string | undefined {
  const failure = classifyRemoteError(error);
  if (failure.kind === "temporary" || isConnectionFailure(failure)) return undefined;
  return failure.message;
}

const port: DelegatedDiscoveryPort = {
  host: (cwd) => featureHost(cwd, "sessions.desktop"),
  list: (machineId, projectId, parentSessionId) =>
    remoteRequest<HostSessionSummary[]>(machineId, "sessions.list", { projectId, parentSessionId }),
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
    const report = (error: unknown) => {
      const message = delegatedDiscoveryFailure(error);
      if (current && message !== undefined) setFailure({ parentId, message });
    };
    const load = async () => {
      try {
        const snapshot = getSessions().find((session) => session.id === parentId);
        if (!snapshot) return;
        const children = await discoverDelegatedRuns(snapshot, port, known, () => current);
        if (!current) return;
        setSessions((sessions) => {
          const updates = new Map(children.map((child) => [child.id, child]));
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
