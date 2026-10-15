import type { LiveAgent } from "../../features/sessions/model/liveAgents";

export type WindowLiveAgents = {
  ownerWindowLabel: string;
  agents: LiveAgent[];
  /** Renderer identity and summary revision let heartbeats avoid serializing payloads. */
  sourceId?: string;
  revision?: number;
  sessionsRevision?: number;
  /** Maps webview-owned session ids to their canonical host id when adopted. */
  ownedSessionKeys?: Record<string, string>;
};

/** Local ownership wins while a transfer is being acknowledged. Host-only
 * summaries may be advertised by several windows, but appear only once. */
export function mergeWindowLiveAgents(
  local: LiveAgent[],
  snapshots: readonly WindowLiveAgents[],
  currentWindowLabel: string,
  localOwnedSessionKeys?: Record<string, string>,
): LiveAgent[] {
  const byId = new Map<string, LiveAgent>();
  const candidates = [
    {
      ownerWindowLabel: currentWindowLabel,
      agents: local,
      ownedSessionKeys: localOwnedSessionKeys,
    },
    ...snapshots.filter((snapshot) => snapshot.ownerWindowLabel !== currentWindowLabel),
  ];
  // An actual adopted session must outrank an unopened host summary, even
  // when that host summary is in this window's local list.
  for (const owned of [true, false])
    for (const snapshot of candidates) {
      for (const agent of snapshot.agents) {
        const key = snapshot.ownedSessionKeys?.[agent.id];
        if (Boolean(key) !== owned) continue;
        if (!byId.has(key ?? agent.id)) {
          byId.set(
            key ?? agent.id,
            snapshot.ownerWindowLabel === currentWindowLabel
              ? agent
              : { ...agent, ownerWindowLabel: snapshot.ownerWindowLabel },
          );
        }
      }
    }
  return [...byId.values()].sort(
    (a, b) =>
      Number(b.needsApproval) - Number(a.needsApproval) ||
      Number(a.done) - Number(b.done) ||
      (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER),
  );
}
