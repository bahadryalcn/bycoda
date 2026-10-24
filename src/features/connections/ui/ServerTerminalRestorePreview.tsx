import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Modal } from "../../../shared/ui/Modal";
import { Badge } from "../../../shared/ui/Badge";
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
  defaultOpen = true,
}: {
  restore: ServerTerminalRestore;
  servers: readonly ServerRecord[];
  inventoryReady?: boolean;
  onConnect: (tab: ServerTerminalRestoreTab, server: ServerRecord) => void | Promise<void>;
  onRemove: (tabId: string) => void;
  defaultOpen?: boolean;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string[]>();
  const selectedTabs = restore.tabs.filter((tab) => selected.has(tab.tabId));
  if (!restore.tabs.length) return null;
  return (
    <details className="border-t border-stroke pbs-2 text-xs" open={defaultOpen || undefined}>
      <summary className="cursor-pointer py-1 font-medium text-(--ui-text-secondary)">
        {t("Saved SSH tabs")} ({restore.tabs.length}) · {t("Not connected")}
      </summary>
      <p className="mbs-2 text-(--ui-text-muted)">
        {t(
          "Restored tabs reconnect only when you choose Connect. This opens a new shell; previous commands are not replayed.",
        )}
      </p>
      {error ? (
        <p className="mbs-2 text-(--ui-tone-danger-fg)" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mbs-2 flex flex-wrap items-center gap-2">
        <Checkbox
          aria-label={t("Select saved SSH tabs")}
          checked={selectedTabs.length === restore.tabs.length}
          indeterminate={selectedTabs.length > 0 && selectedTabs.length < restore.tabs.length}
          disabled={pending !== undefined || !inventoryReady}
          onChange={(event) =>
            setSelected(new Set(event.target.checked ? restore.tabs.map((tab) => tab.tabId) : []))
          }
        />
        <span className="text-(--ui-text-muted)">
          {selectedTabs.length
            ? t("{p0} selected", { p0: selectedTabs.length })
            : t("Select saved SSH tabs")}
        </span>
        {selectedTabs.length ? (
          <Button
            variant="ghost"
            disabled={pending !== undefined || !inventoryReady}
            onClick={() => setRemoving(selectedTabs.map((tab) => tab.tabId))}
          >
            {t("Remove selected")}
          </Button>
        ) : null}
      </div>
      <ul className="mbs-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
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
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-(--ui-surface) px-2 py-2"
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
                <p className="font-medium">
                  {server?.name ?? tab.serverId}
                  {restore.tabs.filter((item) => item.serverId === tab.serverId).length > 1
                    ? ` · ${t("Tab {p0}", { p0: restore.tabs.slice(0, index + 1).filter((item) => item.serverId === tab.serverId).length })}`
                    : ""}
                </p>
                <p className="text-(--ui-text-muted)">
                  {target ?? t(inventoryReady ? "Unavailable" : "Loading…")}
                </p>
              </div>
              {!server && inventoryReady ? <Badge size="sm">{t("Unavailable")}</Badge> : null}
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
      {removing ? (
        <Modal
          title={t("Remove {p0} saved tabs?", { p0: removing.length })}
          size="sm"
          onClose={() => setRemoving(undefined)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRemoving(undefined)}>{t("Cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  for (const id of removing) onRemove(id);
                  setSelected(new Set());
                  setRemoving(undefined);
                }}
              >
                {t("Remove selected")}
              </Button>
            </div>
          }
        >
          <p className="p-4 text-sm">
            {t("Only saved tab references are removed. Servers and open terminals are kept.")}
          </p>
        </Modal>
      ) : null}
    </details>
  );
}
