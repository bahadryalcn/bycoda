import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { useId, useState } from "react";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Switch } from "../../../shared/ui/Switch";
import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import { loadWorkspaceSnapshot } from "../../sessions/public/sessionStore";
import { useServerInventory, type ServerRecord } from "../model/serverInventory";
import {
  serverTerminalRestoreState,
  useServerTerminalRestoreState,
} from "../model/serverTerminalRestoreState";
import type { ServerTerminalRestoreTab } from "../model/serverTerminalRestore";
import { surfaceAttributes } from "../../../shared/ui/Surface";
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
  const regionId = useId();
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
  const failed = state.loadFailed || state.saveStatus === "failed";
  return (
    <Text
      as="section"
      size="caption"
      tone="inherit"
      aria-label={t("Saved SSH tabs")}
      {...surfaceAttributes({ frame: "stroke", edge: "top" }, "shrink-0 px-3")}
    >
      <SectionLabel
        collapsible
        expanded={expanded}
        onExpandedChange={setExpanded}
        controls={regionId}
        count={state.pending.length || null}
      >
        {t("Saved SSH tabs")}
        {failed ? ` · ${t("Failed")}` : ""}
      </SectionLabel>
      {/* Kept mounted while collapsed so a selection in the saved-tab list survives. */}
      <div
        id={regionId}
        hidden={!expanded}
        className={expanded ? "flex flex-col gap-2 pbe-2 pbs-1" : "hidden"}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Switch
            label={t("Remember saved SSH tabs")}
            checked={state.restore?.enabled === true}
            disabled={!state.initialized}
            onCheckedChange={(checked) => serverTerminalRestoreState.setEnabled(checked, openTabs)}
          />
          {!state.pending.length ? (
            <Text as="p" size="inherit" className="min-w-0">
              {t(
                "Restored tabs reconnect only when you choose Connect. This opens a new shell; previous commands are not replayed.",
              )}
            </Text>
          ) : null}
        </div>
        {state.saveStatus === "saving" ? (
          <LoadingText delay={false}>{t("Saving…")}</LoadingText>
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
        {state.loadFailed ? (
          <InlineError retry={{ onRetry: () => void retryLoad(), pending: loading }}>
            {t("Couldn’t load saved SSH tabs.")}
          </InlineError>
        ) : null}
        {state.pending.length ? <PendingServerTabs onConnect={onConnect} /> : null}
      </div>
    </Text>
  );
}
