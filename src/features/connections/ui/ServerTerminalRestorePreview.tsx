import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Play, X } from "../../../shared/ui/icons";
import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import type { ServerRecord } from "../model/serverInventory";
import type {
  ServerTerminalRestore,
  ServerTerminalRestoreTab,
} from "../model/serverTerminalRestore";
import { errorText } from "../../../shared/lib/errors";
import { sanitizeConnectionError } from "../model/remoteConnection";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedTabs = restore.tabs.filter((tab) => selected.has(tab.tabId));
  if (!restore.tabs.length) return null;
  return (
    <Text as="div" tone="inherit" className="flex flex-col gap-2">
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          label={
            selectedTabs.length
              ? t("{p0} selected", { p0: selectedTabs.length })
              : t("Select saved SSH tabs")
          }
          checked={selectedTabs.length === restore.tabs.length}
          indeterminate={selectedTabs.length > 0 && selectedTabs.length < restore.tabs.length}
          disabled={pending !== undefined || !inventoryReady}
          onChange={(event) =>
            setSelected(new Set(event.target.checked ? restore.tabs.map((tab) => tab.tabId) : []))
          }
        />
        {selectedTabs.length ? (
          <Button
            variant="ghost"
            disabled={pending !== undefined || !inventoryReady}
            onClick={() => {
              // Only saved tab references go; servers and open terminals are untouched, so no confirmation.
              for (const tab of selectedTabs) onRemove(tab.tabId);
              setSelected(new Set());
            }}
          >
            {t("Remove selected")}
          </Button>
        ) : null}
      </div>
      <ul {...surfaceAttributes({ dividers: "pane" }, "flex flex-col")}>
        {restore.tabs.map((tab, index) => {
          const server = servers.find((record) => record.id === tab.serverId);
          const endpoint = server?.effectiveSshEndpoint ?? server?.sshEndpoint;
          const target = endpoint
            ? `${endpoint.user ? `${endpoint.user}@` : ""}${endpoint.host}:${endpoint.port}`
            : server?.machine?.ssh
              ? `${server.machine.ssh.target}:${server.machine.ssh.port ?? 22}`
              : undefined;
          return (
            <li
              key={tab.tabId}
              className="flex min-w-0 flex-wrap items-center gap-2 py-2"
              aria-current={restore.activeTabId === tab.tabId ? "true" : undefined}
            >
              <Checkbox
                aria-label={t("Select saved tab {p0}", { p0: index + 1 })}
                checked={selected.has(tab.tabId)}
                disabled={pending !== undefined || !inventoryReady}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(tab.tabId);
                    else next.delete(tab.tabId);
                    return next;
                  });
                }}
              />
              <div className="min-w-0 flex-1 basis-32 break-all">
                <Text as="p" size="inherit" tone="inherit" weight="medium">
                  {server?.name ?? tab.serverId}
                  {restore.tabs.filter((item) => item.serverId === tab.serverId).length > 1
                    ? ` · ${t("Tab {p0}", { p0: restore.tabs.slice(0, index + 1).filter((item) => item.serverId === tab.serverId).length })}`
                    : ""}
                </Text>
                <Text as="p" size="inherit" tone="muted">
                  {target ?? t(inventoryReady ? "Unavailable" : "Loading…")}
                </Text>
              </div>
              {server && target ? (
                <Button
                  iconOnly
                  variant="ghost"
                  label={t("Connect")}
                  disabled={!inventoryReady || pending !== undefined}
                  loading={pending === tab.tabId}
                  onClick={async () => {
                    if (pending !== undefined) return;
                    setPending(tab.tabId);
                    setError("");
                    try {
                      await onConnect(tab, server);
                    } catch (reason) {
                      setError(sanitizeConnectionError(errorText(reason)));
                    } finally {
                      setPending(undefined);
                    }
                  }}
                >
                  <Play className="icon-sm" />
                </Button>
              ) : null}
              <Button
                iconOnly
                variant="ghost"
                label={t("Remove")}
                disabled={pending !== undefined || !inventoryReady}
                onClick={() => onRemove(tab.tabId)}
              >
                <X className="icon-sm" />
              </Button>
            </li>
          );
        })}
      </ul>
    </Text>
  );
}
