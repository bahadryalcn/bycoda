import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { QuickConnect } from "./QuickConnect";
import { useOpenQuickServerTerminal } from "./ServersTerminalWorkspace";
import { SshServerEditor } from "./SshServerEditor";
import { ServerOrganization } from "./ServerOrganization";
import { ServersConnectionTools } from "./ServersConnectionTools";
import { useServerInventory, type ServerRecord } from "../model/serverInventory";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Loader, Plus, RefreshCw, Server, ListFilter, Star } from "../../../shared/ui/icons";
import {
  requestMachineEdit,
  requestMachineReconnect,
  useRemoteMachineOnline,
} from "../model/connections";
import { requestMachineAdd } from "../model/machineAdd";
import type { RemoteMachine } from "../model/protocol";
import { connectionIndicator, needsSignIn } from "../model/remoteConnection";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";

/** Display addresses without URL credentials or query strings. Records stay native-owned. */
function machineAddress(machine: RemoteMachine) {
  if (machine.ssh) return machine.ssh.target;
  try {
    const url = new URL(machine.endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return t("Address unavailable");
  }
}

function MachineStatus({
  machine,
  details = false,
}: {
  machine: RemoteMachine;
  details?: boolean;
}) {
  useRemoteMachineOnline(machine.id);
  const state = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(machine.environmentId),
    () => readRemoteConnection(machine.environmentId),
  );
  const indicator = connectionIndicator(state, false);
  const label =
    state.status === "host-key"
      ? t("Review required")
      : state.status === "needs-auth"
        ? t("Authentication required")
        : state.status === "outdated-host"
          ? t("Update Host")
          : indicator.tone === "down"
            ? t("Not connected")
            : indicator.tone === "connecting"
              ? t("Connecting")
              : t("Connected");
  const badge = (
    <Badge
      size="sm"
      title={t(indicator.label)}
      tone={
        needsSignIn(state.status)
          ? "warning"
          : indicator.tone === "connected"
            ? "success"
            : "neutral"
      }
    >
      {label}
    </Badge>
  );
  if (!details) return badge;
  return (
    <div className="flex flex-col items-start gap-2" aria-live="polite">
      {badge}
      {state.error ? (
        <details
          className="w-full text-xs text-(--ui-text-muted)"
          open={needsSignIn(state.status) || undefined}
        >
          <summary className="cursor-pointer py-1">{t("Connection details")}</summary>
          <p className="mbs-1 break-words leading-relaxed">{state.error}</p>
        </details>
      ) : null}
    </div>
  );
}

export type ServersViewProps = {
  onClose?: () => void;
  onToggleSidebar?: () => void;
  besideRail?: boolean;
  compactRail?: boolean;
};

/** Inventory over the same machine IDs and host health used by Settings and the rail. */
export function ServersView({
  onClose = () => {},
  onToggleSidebar,
  besideRail = false,
  compactRail = false,
}: ServersViewProps = {}) {
  useLocale();
  const { servers, loaded, loading, error, refresh } = useServerInventory();
  const openQuick = useOpenQuickServerTerminal();
  const [quickConnect, setQuickConnect] = useState(false);
  const [editor, setEditor] = useState<ServerRecord | "new" | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersAnchor = useRef<HTMLButtonElement>(null);
  const [group, setGroup] = useRetainedState("servers:group", "");
  const [tag, setTag] = useRetainedState("servers:tag", "");
  const [favoritesOnly, setFavoritesOnly] = useRetainedState("servers:favorites", false);
  const [recentFirst, setRecentFirst] = useRetainedState("servers:recent", false);
  const [search, setSearch] = useRetainedState("servers:search", "");
  const [selectedId, setSelectedId] = useRetainedState<string | undefined>(
    "servers:selected",
    undefined,
  );
  const [scrollTop, setScrollTop] = useRetainedState("servers:scroll", 0);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = scrollTop;
    // Restore after mounting or after the canonical records finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const query = search.trim().toLocaleLowerCase();
  const address = (server: ServerRecord) =>
    server.machine
      ? machineAddress(server.machine)
      : `${server.sshEndpoint?.user ? `${server.sshEndpoint.user}@` : ""}${server.sshEndpoint?.host ?? ""}`;
  const groups = [
    ...new Set(servers.flatMap((server) => (server.metadata.group ? [server.metadata.group] : []))),
  ].sort();
  const tags = [...new Set(servers.flatMap((server) => server.metadata.tags))].sort();
  const filtered = servers.filter(
    (server) =>
      `${server.name} ${address(server)} ${server.machine?.ssh?.alternate ?? ""} ${server.metadata.group ?? ""} ${server.metadata.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query) &&
      (!group || server.metadata.group === group) &&
      (!tag || server.metadata.tags.includes(tag)) &&
      (!favoritesOnly || server.metadata.favorite),
  );
  if (recentFirst)
    filtered.sort((a, b) => (b.metadata.lastUsedAt ?? 0) - (a.metadata.lastUsedAt ?? 0));
  const selected = servers.find((server) => server.id === selectedId);
  const filterCount = Number(!!group) + Number(!!tag) + Number(favoritesOnly) + Number(recentFirst);
  return (
    <section
      aria-label={t("Servers")}
      data-app-servers
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-(--ui-surface) text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-sm">
            <Server aria-hidden className="size-3.5 shrink-0 text-(--ui-text-muted)" />
            <span className="truncate">{t("Servers")}</span>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-stroke px-3 py-2">
        <SearchInput
          appearance="field"
          containerClassName="min-w-32 flex-1"
          aria-label={t("Search servers")}
          placeholder={t("Search by name or address")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          ref={filtersAnchor}
          variant="ghost"
          iconOnly
          label={t("Server filters")}
          selected={filterCount > 0}
          aria-expanded={filtersOpen}
          aria-haspopup="dialog"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <ListFilter aria-hidden className="size-3.5" />
          {filterCount > 0 ? <span className="sr-only">{filterCount}</span> : null}
        </Button>
        {filtersOpen ? (
          <Popover
            anchor={filtersAnchor}
            align="end"
            width={280}
            role="dialog"
            aria-label={t("Server filters")}
            onDismiss={() => setFiltersOpen(false)}
          >
            <div className="flex flex-col gap-3 p-3">
              <SearchableSelect
                label={t("Group")}
                value={group}
                options={[
                  { value: "", label: t("All groups") },
                  ...groups.map((value) => ({ value, label: value })),
                ]}
                onChange={setGroup}
              />
              <SearchableSelect
                label={t("Tags")}
                value={tag}
                options={[
                  { value: "", label: t("All tags") },
                  ...tags.map((value) => ({ value, label: value })),
                ]}
                onChange={setTag}
              />
              <Switch
                label={t("Favorites only")}
                checked={favoritesOnly}
                onCheckedChange={setFavoritesOnly}
              />
              <Switch
                label={t("Recently used first")}
                checked={recentFirst}
                onCheckedChange={setRecentFirst}
              />
              <Button
                variant="ghost"
                disabled={!filterCount}
                onClick={() => {
                  setGroup("");
                  setTag("");
                  setFavoritesOnly(false);
                  setRecentFirst(false);
                }}
              >
                {t("Reset filters")}
              </Button>
            </div>
          </Popover>
        ) : null}
        <Button
          variant="ghost"
          iconOnly
          label={t("Refresh servers")}
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw aria-hidden className="size-3.5" />
        </Button>
        {openQuick ? (
          <Button variant="ghost" onClick={() => setQuickConnect(true)}>
            {t("Quick connect")}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setEditor("new")}>
          <Plus aria-hidden className="size-3.5" />
          {t("Add SSH server")}
        </Button>
        <Button variant="ghost" iconOnly label={t("Add machine")} onClick={requestMachineAdd}>
          <Plus aria-hidden className="size-3.5" />
        </Button>
      </div>
      {error ? (
        <div className="px-3 py-2">
          <Alert tone="warning" role="alert">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span>
                {loaded
                  ? t("Couldn’t refresh servers. Showing last loaded data.")
                  : t("Couldn’t load servers.")}
              </span>
              <Button variant="ghost" disabled={loading} onClick={refresh}>
                {t("Retry")}
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}
      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 text-sm text-(--ui-text-muted)"
        >
          <Loader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          {loaded ? t("Refreshing servers…") : t("Loading servers…")}
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <div
          ref={list}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2"
        >
          {loaded && servers.length === 0 ? (
            <p className="py-8 text-center text-sm text-(--ui-text-muted)">
              {t("No machines connected.")}
            </p>
          ) : null}
          {servers.length > 0 && filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-(--ui-text-muted)">
              {t("No matching servers.")}
            </p>
          ) : null}
          <ul
            aria-label={t("Servers")}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-1"
          >
            {filtered.map((server) => (
              <li key={server.id} className="min-w-0">
                <Button
                  variant="item"
                  selected={selectedId === server.id}
                  aria-pressed={selectedId === server.id}
                  className="h-auto min-h-14 w-full"
                  onClick={() => setSelectedId(server.id)}
                >
                  <Server aria-hidden className="size-4 shrink-0 text-(--ui-text-muted)" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span title={server.name} className="truncate font-medium">
                        {server.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {server.metadata.favorite ? (
                          <Star
                            aria-label={t("Favorite")}
                            className="size-3 text-(--ui-text-muted)"
                          />
                        ) : null}
                        {server.machine ? (
                          <MachineStatus machine={server.machine} />
                        ) : (
                          <Badge size="sm">SSH</Badge>
                        )}
                      </span>
                    </span>
                    <span
                      title={address(server)}
                      className="truncate text-xs text-(--ui-text-muted)"
                    >
                      {address(server)}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
        {selected ? (
          <section
            aria-label={t("Server details")}
            className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto border-t border-stroke p-3 md:max-h-none md:w-72 md:border-t-0 md:border-s"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Server aria-hidden className="size-4 shrink-0 text-(--ui-text-muted)" />
              <h2 className="min-w-0 truncate text-sm font-medium" title={selected.name}>
                {selected.name}
              </h2>
            </div>
            {selected.machine?.ssh || selected.kind === "ssh" ? (
              <div className="mbs-3 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    selected.kind === "ssh" ? setEditor(selected) : requestMachineEdit(selected.id)
                  }
                >
                  {t("Edit machine")}
                </Button>
                {selected.kind === "host" ? (
                  <Button onClick={() => requestMachineReconnect(selected.id)}>
                    {t("Reconnect")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="mbs-3 border-t border-stroke pbs-3">
              {selected.machine ? (
                <MachineStatus key={selected.id} machine={selected.machine} details />
              ) : (
                <Badge size="sm">{t("SSH only")}</Badge>
              )}
            </div>
            <dl className="mbs-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
              <dt className="text-(--ui-text-muted)">{t("Address")}</dt>
              <dd className="break-all">{address(selected)}</dd>
              {selected.machine?.ssh || selected.sshEndpoint ? (
                <>
                  <dt className="text-(--ui-text-muted)">{t("SSH port")}</dt>
                  <dd>{selected.sshEndpoint?.port ?? selected.machine?.ssh?.port ?? 22}</dd>
                  {selected.machine?.ssh ? (
                    <>
                      <dt className="text-(--ui-text-muted)">{t("Host service port")}</dt>
                      <dd>{selected.machine.ssh.remotePort}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
            </dl>
            <ServerOrganization key={selected.id} server={selected} />
            <ServersConnectionTools
              server={selected}
              servers={servers}
              onUseServer={setSelectedId}
              onEditServer={(existing) => {
                setSelectedId(existing.id);
                setEditor(existing);
              }}
            />
          </section>
        ) : null}
      </div>
      {quickConnect ? <QuickConnect onClose={() => setQuickConnect(false)} /> : null}
      {editor ? (
        <SshServerEditor
          key={editor === "new" ? "new" : editor.id}
          server={editor === "new" ? undefined : editor}
          onClose={() => setEditor(undefined)}
          onSaved={(saved) => {
            setSelectedId(saved.id);
            setEditor(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
