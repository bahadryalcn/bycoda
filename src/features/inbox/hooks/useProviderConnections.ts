import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { AZUREDEVOPS_CHANGE_EVENT, azureDevOpsConnected } from "../model/azureDevOps";
import { githubStatus } from "../model/githubTasks";
import { GITLAB_CHANGE_EVENT, gitlabConnected } from "../model/gitlab";
import { JIRA_CHANGE_EVENT, jiraConnected } from "../model/jira";
import { LINEAR_CHANGE_EVENT, linearConnected } from "../model/linear";

export type ProviderConnectionId = "github" | "linear" | "jira" | "gitlab" | "azuredevops";

/** `null` means the provider's status has never been read successfully. */
export type ProviderConnections = Record<ProviderConnectionId, boolean | null>;

export type ProviderConnectionSnapshot = {
  /** Last successfully read status per provider (or the initial value). */
  connections: ProviderConnections;
  /**
   * The newest read of this provider was rejected, so its `connections` value
   * is last-known, not a fresh answer. A rejected read never means "revoked".
   */
  unavailable: Record<ProviderConnectionId, boolean>;
};

const PROVIDER_IDS: readonly ProviderConnectionId[] = [
  "github",
  "linear",
  "jira",
  "gitlab",
  "azuredevops",
];

export const UNKNOWN_PROVIDER_CONNECTIONS: ProviderConnections = {
  github: null,
  linear: null,
  jira: null,
  gitlab: null,
  azuredevops: null,
};

const AVAILABLE: Record<ProviderConnectionId, boolean> = {
  github: false,
  linear: false,
  jira: false,
  gitlab: false,
  azuredevops: false,
};

function readProviderStatuses() {
  return Promise.allSettled([
    githubStatus(),
    linearConnected(),
    jiraConnected(),
    gitlabConnected(),
    azureDevOpsConnected(),
  ]);
}

/**
 * Provider connection snapshot shared by Inbox and Automations.
 *
 * Reads run on mount and on each provider-change event. Reads can overlap and
 * settle out of order, so every read owns a generation and only the newest may
 * write; an older answer is dropped instead of restoring a stale one. A rejected
 * provider read keeps that provider's last-known value and flags it
 * `unavailable` rather than inferring a revocation. Credentials are never read:
 * only the `connected` flags the existing status commands already return.
 *
 * `persist` receives the connections each time the newest read lands, so an
 * owner can keep a last-known copy without mirroring the snapshot in an effect.
 */
export function useProviderConnections(
  initial: () => ProviderConnections = () => UNKNOWN_PROVIDER_CONNECTIONS,
  persist?: (connections: ProviderConnections) => void,
): ProviderConnectionSnapshot {
  const [snapshot, setSnapshot] = useState<ProviderConnectionSnapshot>(() => ({
    connections: initial(),
    unavailable: AVAILABLE,
  }));
  const latest = useRef(snapshot);
  const persistConnections = useStableCallback(persist);

  useEffect(() => {
    let cancelled = false;
    let newestRead = 0;
    const read = () => {
      const generation = ++newestRead;
      void readProviderStatuses().then((results) => {
        if (cancelled || generation !== newestRead) return;
        const prev = latest.current;
        const connections = { ...prev.connections };
        const unavailable = { ...AVAILABLE };
        PROVIDER_IDS.forEach((id, index) => {
          const result = results[index]!;
          if (result.status === "fulfilled") {
            connections[id] = (result.value as { connected: boolean }).connected;
          } else {
            unavailable[id] = true;
          }
        });
        const unchanged = PROVIDER_IDS.every(
          (id) =>
            connections[id] === prev.connections[id] && unavailable[id] === prev.unavailable[id],
        );
        if (!unchanged) {
          latest.current = { connections, unavailable };
          setSnapshot(latest.current);
        }
        persistConnections?.(latest.current.connections);
      });
    };
    read();
    window.addEventListener(LINEAR_CHANGE_EVENT, read);
    window.addEventListener(JIRA_CHANGE_EVENT, read);
    window.addEventListener(GITLAB_CHANGE_EVENT, read);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(LINEAR_CHANGE_EVENT, read);
      window.removeEventListener(JIRA_CHANGE_EVENT, read);
      window.removeEventListener(GITLAB_CHANGE_EVENT, read);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, read);
    };
  }, [persistConnections]);

  return snapshot;
}
