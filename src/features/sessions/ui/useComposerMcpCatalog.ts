import { useCallback, useEffect, useState } from "react";
import type { McpConnection } from "../../settings";
import {
  getCachedMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
  type McpSettingsSnapshot,
} from "../../settings/public/mcpSettingsCache";
import type { HarnessId } from "../model/session";

export type ComposerMcpCatalog = {
  connections: McpConnection[];
  /** Claude health by server name; empty for other harnesses. */
  status: ReadonlyMap<string, string>;
  loading: boolean;
  error: string;
};

type ScopedMcpCatalog = ComposerMcpCatalog & { scope: string };

const NO_CONNECTIONS: McpConnection[] = [];
const NO_STATUS: ReadonlyMap<string, string> = new Map();
const IDLE: ComposerMcpCatalog = {
  connections: NO_CONNECTIONS,
  status: NO_STATUS,
  loading: false,
  error: "",
};
const LOADING: ComposerMcpCatalog = { ...IDLE, loading: true };

/** One MCP read is valid for a single execution directory and health mode. */
export function mcpCatalogScope(executionCwd: string, claudeHealth: boolean): string {
  return `${claudeHealth ? "claude" : "plain"}\n${executionCwd}`;
}

export function claudeMcpStatus(servers: McpSettingsSnapshot["servers"]): Map<string, string> {
  return new Map(
    servers
      .filter((server) => server.provider === "claude")
      .map((server): [string, string] => [server.name, server.status]),
  );
}

/** Rejects a read that belongs to another scope than the one being shown. */
export function visibleMcpCatalog(
  state: ScopedMcpCatalog | null,
  scope: string,
  active: boolean,
): ComposerMcpCatalog {
  if (state && state.scope === scope) return state;
  return active ? LOADING : IDLE;
}

/**
 * Read-only MCP server list for the composer's picker. It subscribes only while
 * `active`, and a snapshot that arrives after the scope changed or the picker
 * closed is dropped. Which servers are tagged on the draft stays with the
 * Composer's draft owner.
 */
export function useComposerMcpCatalog(input: {
  executionCwd: string;
  harness: HarnessId;
  active: boolean;
}): ComposerMcpCatalog & { reset(): void } {
  const { executionCwd, harness, active } = input;
  const claudeHealth = harness === "claude";
  const scope = mcpCatalogScope(executionCwd, claudeHealth);
  const [state, setState] = useState<ScopedMcpCatalog | null>(null);

  /** Opening the picker shows a loading list rather than the previous one. */
  const reset = useCallback(() => {
    setState({ ...LOADING, scope });
  }, [scope]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const apply = (snapshot: McpSettingsSnapshot) => {
      if (cancelled) return;
      setState({
        scope,
        connections: snapshot.servers,
        status: claudeMcpStatus(snapshot.servers),
        error: snapshot.error,
        loading: false,
      });
    };
    const stop = subscribeMcpSettings(executionCwd, apply);
    const cached = getCachedMcpSettings(executionCwd);
    if (cached) apply(cached);
    void loadMcpSettings(executionCwd, false, { claudeHealth });
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, claudeHealth, executionCwd, scope]);

  const view = visibleMcpCatalog(state, scope, active);
  return {
    connections: view.connections,
    status: view.status,
    loading: view.loading,
    error: view.error,
    reset,
  };
}
