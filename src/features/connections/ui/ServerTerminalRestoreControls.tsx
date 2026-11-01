import { useState } from "react";
import { Switch } from "../../../shared/ui/Switch";
import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import { loadWorkspaceSnapshot } from "../../sessions/data/sessionStore";
import { useServerInventory, type ServerRecord } from "../model/serverInventory";
import {
  serverTerminalRestoreState,
  useServerTerminalRestoreState,
} from "../model/serverTerminalRestoreState";
import type { ServerTerminalRestoreTab } from "../model/serverTerminalRestore";
import { ServerTerminalRestorePreview } from "./ServerTerminalRestorePreview";

function PendingServerTabs({
  onConnect,
}: {
  onConnect: (server: ServerRecord, replacingPendingId?: string) => void | Promise<void>;
}) {
  const state = useServerTerminalRestoreState();
  const inventory = useServerInventory();
  if (!state.restore) return null;
  return (
    <div className="max-h-[35vh] overflow-auto">
      {inventory.error ? (
        <InlineError retry={{ onRetry: inventory.refresh, pending: inventory.loading }}>
          {t("Couldn’t load saved SSH tabs.")}
        </InlineError>
      ) : null}
      <ServerTerminalRestorePreview
        defaultOpen={false}
        restore={{
          ...state.restore,
          tabs: state.restore.tabs.filter((tab) => state.pending.includes(tab.tabId)),
        }}
        servers={inventory.servers}
        inventoryReady={inventory.loaded && !inventory.error && !inventory.loading}
        onRemove={serverTerminalRestoreState.remove}
        onConnect={(tab, server) => {
          return onConnect(server, tab.tabId);
        }}
      />
    </div>
  );
}

export function ServerTerminalRestoreControls({
  openTabs,
  onConnect,
  compact = false,
}: {
  compact?: boolean;
  openTabs: readonly ServerTerminalRestoreTab[];
  onConnect: (server: ServerRecord, replacingPendingId?: string) => void | Promise<void>;
}) {
  const state = useServerTerminalRestoreState();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(!compact);
  const [seenCompact, setSeenCompact] = useState(compact);
  // Follow the prop during render: a new layout restarts from its default.
  if (seenCompact !== compact) {
    setSeenCompact(compact);
    setExpanded(!compact);
  }
  const retryLoad = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const raw = await loadWorkspaceSnapshot();
      serverTerminalRestoreState.initialize(
        raw && typeof raw === "object" && "serversRestore" in raw ? raw.serversRestore : undefined,
      );
    } catch {
      serverTerminalRestoreState.loadFailed();
    } finally {
      setLoading(false);
    }
  };
  if (!state.owner) return null;
  return (
    <details
      className="shrink-0 border-t border-stroke px-3 text-ui-caption"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer py-1 text-(--ui-text-secondary)">
        {t("Saved SSH tabs")}
        {state.pending.length ? ` (${state.pending.length})` : ""}
        {state.loadFailed || state.saveStatus === "failed" ? ` · ${t("Failed")}` : ""}
      </summary>
      <div className="flex flex-col gap-2 py-2">
        <div className="flex items-center gap-2 text-(--ui-text-muted)">
          <Switch
            label={t("Remember saved SSH tabs")}
            checked={state.restore?.enabled === true}
            disabled={!state.initialized}
            onCheckedChange={(checked) => serverTerminalRestoreState.setEnabled(checked, openTabs)}
          />
        </div>
        {state.saveStatus === "saving" ? (
          <p className="text-(--ui-text-muted)" role="status">
            {t("Saving…")}
          </p>
        ) : null}
        {state.saveStatus === "failed" ? (
          <InlineError
            retry={
              state.canRetrySave
                ? { onRetry: () => void serverTerminalRestoreState.retrySave() }
                : undefined
            }
          >
            {t("Couldn’t save SSH tabs.")}
            {state.saveError ? ` ${state.saveError}` : ""}
          </InlineError>
        ) : null}
        {!state.pending.length ? (
          <p className="text-(--ui-text-muted)">
            {t(
              "Restored tabs reconnect only when you choose Connect. This opens a new shell; previous commands are not replayed.",
            )}
          </p>
        ) : null}
        {state.loadFailed ? (
          <InlineError retry={{ onRetry: () => void retryLoad(), pending: loading }}>
            {t("Couldn’t load saved SSH tabs.")}
          </InlineError>
        ) : null}
        {state.pending.length ? <PendingServerTabs onConnect={onConnect} /> : null}
      </div>
    </details>
  );
}
