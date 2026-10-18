import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import type { ServerRecord } from "../model/serverInventory";
import type {
  ServerTerminalRestore,
  ServerTerminalRestoreTab,
} from "../model/serverTerminalRestore";

/** Read-only cold-restore preview. The parent owns persistence and must open a
 * fresh raw terminal ONLY in onConnect; mounting this never invokes callbacks.
 */
export function ServerTerminalRestorePreview({
  restore,
  servers,
  inventoryReady = true,
  onConnect,
  onRemove,
}: {
  restore: ServerTerminalRestore;
  servers: readonly ServerRecord[];
  inventoryReady?: boolean;
  onConnect: (tab: ServerTerminalRestoreTab, server: ServerRecord) => void | Promise<void>;
  onRemove: (tabId: string) => void;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  if (!restore.tabs.length) return null;
  return (
    <details className="border-t border-stroke pbs-2 text-xs" open>
      <summary className="cursor-pointer text-(--ui-text-muted)">
        {t("SSH terminals")} ({restore.tabs.length})
      </summary>
      <p className="mbs-2 text-(--ui-text-muted)">
        {t("Restored tabs reconnect only when you choose Connect.")}
      </p>
      {error ? (
        <p className="mbs-2 text-(--ui-tone-danger-fg)" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="mbs-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
        {restore.tabs.map((tab) => {
          const server = servers.find((record) => record.id === tab.serverId);
          const endpoint = server?.sshEndpoint;
          const target = endpoint
            ? `${endpoint.user ? `${endpoint.user}@` : ""}${endpoint.host}:${endpoint.port}`
            : server?.machine?.ssh
              ? `${server.machine.ssh.target}:${server.machine.ssh.port ?? 22}`
              : undefined;
          return (
            <li
              key={tab.tabId}
              className="flex min-w-0 flex-wrap items-center gap-2"
              aria-current={restore.activeTabId === tab.tabId ? "true" : undefined}
            >
              <div className="min-w-0 flex-1 basis-40 break-all">
                <p>{server?.name ?? tab.serverId}</p>
                <p className="text-(--ui-text-muted)">
                  {target ?? t(inventoryReady ? "Unavailable" : "Loading…")}
                </p>
              </div>
              {server && target ? (
                <Button
                  size="sm"
                  disabled={!inventoryReady || pending !== undefined}
                  loading={pending === tab.tabId}
                  onClick={async () => {
                    if (pending !== undefined) return;
                    setPending(tab.tabId);
                    setError("");
                    try {
                      await onConnect(tab, server);
                    } catch (reason) {
                      setError(String(reason));
                    } finally {
                      setPending(undefined);
                    }
                  }}
                >
                  {t("Connect")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending !== undefined || !inventoryReady}
                onClick={() => onRemove(tab.tabId)}
              >
                {t("Remove")}
              </Button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
