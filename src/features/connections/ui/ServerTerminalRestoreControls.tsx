import { useState } from "react";
import { Switch } from "../../../shared/ui/Switch";
import { Button } from "../../../shared/ui/Button";
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
  onConnect: (server: ServerRecord, replacingPendingId?: string) => void;
}) {
  const state = useServerTerminalRestoreState();
  const inventory = useServerInventory();
  if (!state.restore) return null;
  return (
    <div className="max-h-[35vh] overflow-auto">
      {inventory.error ? (
        <p className="text-xs text-(--ui-tone-danger-fg)" role="alert">
          {t("Couldn’t load saved SSH tabs.")}
        </p>
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
          onConnect(server, tab.tabId);
        }}
      />
    </div>
  );
}

export function ServerTerminalRestoreControls({
  openTabs,
  onConnect,
}: {
  openTabs: readonly ServerTerminalRestoreTab[];
  onConnect: (server: ServerRecord, replacingPendingId?: string) => void;
}) {
  const state = useServerTerminalRestoreState();
  const [loading, setLoading] = useState(false);
  if (!state.owner) return null;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-stroke px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-(--ui-text-muted)">
        <Switch
          label={t("Remember saved SSH tabs")}
          checked={state.restore?.enabled === true}
          disabled={!state.initialized}
          onCheckedChange={(checked) => serverTerminalRestoreState.setEnabled(checked, openTabs)}
        />
        {t("Remember saved SSH tabs")}
      </div>
      {state.loadFailed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-(--ui-tone-danger-fg)" role="alert">
            {t("Couldn’t load saved SSH tabs.")}
          </p>
          <Button
            size="sm"
            variant="ghost"
            loading={loading}
            onClick={async () => {
              if (loading) return;
              setLoading(true);
              try {
                const raw = await loadWorkspaceSnapshot();
                serverTerminalRestoreState.initialize(
                  raw && typeof raw === "object" && "serversRestore" in raw
                    ? raw.serversRestore
                    : undefined,
                );
              } catch {
                serverTerminalRestoreState.loadFailed();
              } finally {
                setLoading(false);
              }
            }}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {state.pending.length ? <PendingServerTabs onConnect={onConnect} /> : null}
    </div>
  );
}
