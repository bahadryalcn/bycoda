import { useLayoutEffect, useRef, useState } from "react";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { ContextMenu, type ContextMenuItem } from "../../../shared/ui/ContextMenu";
import { Popover } from "../../../shared/ui/Popover";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { QuickConnect } from "./QuickConnect";
import { useOpenQuickServerTerminal, useOpenServerTerminal } from "./ServersTerminalWorkspace";
import { SshServerEditor } from "./SshServerEditor";
import { SshSettings } from "./SshSettings";
import { TermiusImportDialog } from "./TermiusImportDialog";
import { ServersConnectionTools } from "./ServersConnectionTools";
import {
  removeSshConnection,
  updateServerMetadata,
  useServerInventory,
  type ServerMetadataPatch,
  type ServerRecord,
} from "../model/serverInventory";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  Loader,
  LayoutGrid,
  ListBullet,
  Plus,
  RefreshCw,
  Server,
  ListFilter,
  X,
  Lock,
  Pencil,
  MoreHorizontal,
  Trash2,
  Terminal,
  Info,
  Star,
  Palette,
  Copy,
} from "../../../shared/ui/icons";
import { disconnectMachine, requestMachineEdit } from "../model/connections";
import { requestMachineAdd } from "../model/machineAdd";
import type { RemoteMachine } from "../model/protocol";
import { MachineStatus, ReconnectAction } from "./ServerStatus";
import { ServerItem, type ServerMenuAt } from "./ServerItem";
import { ServerColorPopover } from "./ServerColorPopover";
import { serverAccentColor } from "./serverColor";
import { useServersLayout, type ServersLayout } from "./serversLayout";

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

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function ViewToggle({
  layout,
  onChange,
}: {
  layout: ServersLayout;
  onChange: (layout: ServersLayout) => void;
}) {
  useLocale();
  return (
    <div role="group" aria-label={t("Server view")} className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        iconOnly
        label={t("List view")}
        tooltip={t("List view")}
        selected={layout === "list"}
        aria-pressed={layout === "list"}
        onClick={() => onChange("list")}
      >
        <ListBullet aria-hidden className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        iconOnly
        label={t("Card view")}
        tooltip={t("Card view")}
        selected={layout === "cards"}
        aria-pressed={layout === "cards"}
        onClick={() => onChange("cards")}
      >
        <LayoutGrid aria-hidden className="size-3.5" />
      </Button>
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
  const openTerminal = useOpenServerTerminal();
  const [layout, setLayout] = useServersLayout();
  const canConnect = (server: ServerRecord) =>
    Boolean(openTerminal && (server.kind === "ssh" || server.machine?.ssh));
  const connect = (server: ServerRecord) => {
    if (!canConnect(server)) return;
    setSelectedId(server.id);
    openTerminal?.(server);
  };
  const [quickConnect, setQuickConnect] = useState(false);
  const [sshSettings, setSshSettings] = useState(false);
  const [termiusImport, setTermiusImport] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsAnchor = useRef<HTMLButtonElement>(null);
  const [editor, setEditor] = useState<ServerRecord | "new" | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersAnchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ serverId: string; at: ServerMenuAt } | undefined>();
  const [colorTarget, setColorTarget] = useState<{ serverId: string; at: ServerMenuAt }>();
  const [deleteTarget, setDeleteTarget] = useState<{
    server: ServerRecord;
    at: ServerMenuAt;
  }>();
  const [deleting, setDeleting] = useState<string>();
  const [actionError, setActionError] = useState("");
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
  const address = (server: ServerRecord) => {
    const endpoint = server.effectiveSshEndpoint ?? server.sshEndpoint;
    return server.machine
      ? machineAddress(server.machine)
      : `${endpoint?.user ? `${endpoint.user}@` : ""}${endpoint?.host ?? ""}`;
  };
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
  const menuServer = menu ? servers.find((server) => server.id === menu.serverId) : undefined;
  const colorServer = colorTarget
    ? servers.find((server) => server.id === colorTarget.serverId)
    : undefined;
  const filterCount = Number(!!group) + Number(!!tag) + Number(favoritesOnly) + Number(recentFirst);

  const runAction = async (work: () => Promise<unknown>) => {
    setActionError("");
    try {
      await work();
    } catch (reason) {
      setActionError(errorText(reason));
    }
  };
  const menuItems = (server: ServerRecord): ContextMenuItem[] => [
    ...(canConnect(server)
      ? [
          {
            kind: "item" as const,
            id: "connect",
            label: t("Connect"),
            icon: <Terminal aria-hidden className="size-3.5" />,
          },
        ]
      : []),
    {
      kind: "item",
      id: "details",
      label: t("Show details"),
      icon: <Info aria-hidden className="size-3.5" />,
    },
    {
      kind: "item",
      id: "edit",
      label: server.kind === "ssh" ? t("Edit SSH server") : t("Edit machine"),
      icon: <Pencil aria-hidden className="size-3.5" />,
    },
    {
      kind: "item",
      id: "favorite",
      label: server.metadata.favorite ? t("Unfavorite") : t("Favorite"),
      icon: (
        <Star
          aria-hidden
          className="size-3.5"
          fill={server.metadata.favorite ? "currentColor" : "none"}
        />
      ),
    },
    {
      kind: "item",
      id: "color",
      label: t("Color…"),
      icon: <Palette aria-hidden className="size-3.5" />,
    },
    {
      kind: "item",
      id: "copy",
      label: t("Copy address"),
      icon: <Copy aria-hidden className="size-3.5" />,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "delete",
      label: t("Delete"),
      icon: <Trash2 aria-hidden className="size-3.5" />,
      danger: true,
      title:
        server.kind === "ssh"
          ? undefined
          : t(
              "Removes this machine from this desktop only. The host and its sessions keep running.",
            ),
    },
  ];
  const pickMenuItem = (server: ServerRecord, id: string, at: ServerMenuAt) => {
    setMenu(undefined);
    if (id === "connect") connect(server);
    else if (id === "details") setSelectedId(server.id);
    else if (id === "edit") {
      if (server.kind === "ssh") setEditor(server);
      else requestMachineEdit(server.id);
    } else if (id === "favorite")
      void runAction(() =>
        updateServerMetadata(server.id, { favorite: !server.metadata.favorite }),
      );
    else if (id === "color") setColorTarget({ serverId: server.id, at });
    else if (id === "copy") void runAction(() => navigator.clipboard.writeText(address(server)));
    else if (id === "delete") {
      setActionError("");
      setDeleteTarget({ server, at });
    }
  };
  const openServerMenu = (serverId: string, at: ServerMenuAt) => setMenu({ serverId, at });
  // Deleting is not reversible: the question stays open until the store confirms, and a second press is ignored.
  const deleteServer = async (server: ServerRecord) => {
    if (deleting) return;
    setDeleting(server.id);
    setActionError("");
    try {
      if (server.kind === "ssh") await removeSshConnection(server.id);
      else await disconnectMachine(server.id);
      setSelectedId((current) => (current === server.id ? undefined : current));
    } catch (reason) {
      setActionError(errorText(reason));
      throw reason;
    } finally {
      setDeleting(undefined);
    }
  };
  const saveColor = (serverId: string, patch: ServerMetadataPatch) =>
    void runAction(() => updateServerMetadata(serverId, patch));
  return (
    <section
      aria-label={t("Servers")}
      data-app-servers
      className="@container/servers flex min-h-0 min-w-0 flex-1 flex-col bg-(--ui-surface) text-content"
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
        <div className="flex min-w-0 basis-64 flex-1 items-center gap-2">
          <SearchInput
            appearance="field"
            containerClassName="min-w-0 flex-1"
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
          <ViewToggle layout={layout} onChange={setLayout} />
          <Button
            variant="ghost"
            iconOnly
            label={t("Refresh servers")}
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw aria-hidden className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("Manage SSH")}
            tooltip={t("SSH settings")}
            onClick={() => setSshSettings(true)}
          >
            <Lock aria-hidden className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {openQuick ? (
            <Button variant="primary" onClick={() => setQuickConnect(true)}>
              {t("Quick connect")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setEditor("new")}>
            <Plus aria-hidden className="size-3.5" />
            {t("Add SSH server")}
          </Button>
          <Button variant="ghost" onClick={requestMachineAdd}>
            <Plus aria-hidden className="size-3.5" />
            {t("Add machine")}
          </Button>
          <Button
            ref={actionsAnchor}
            variant="ghost"
            iconOnly
            label={t("More actions")}
            aria-expanded={actionsOpen}
            aria-haspopup="menu"
            onClick={() => setActionsOpen(!actionsOpen)}
          >
            <MoreHorizontal aria-hidden className="size-3.5" />
          </Button>
          {actionsOpen ? (
            <DropdownMenu
              anchor={actionsAnchor}
              label={t("More actions")}
              items={[{ kind: "item", id: "import-termius", label: t("Import from Termius") }]}
              onClose={() => setActionsOpen(false)}
              onPick={() => {
                setActionsOpen(false);
                setTermiusImport(true);
              }}
            />
          ) : null}
        </div>
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
      {actionError ? (
        <div className="px-3 pt-2">
          <Alert tone="danger" role="alert">
            {actionError}
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @min-[44rem]/servers:flex-row">
        <div
          ref={list}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className={`min-h-0 min-w-0 overflow-y-auto p-2 @min-[44rem]/servers:p-3 @min-[44rem]/servers:flex-1 ${selected ? "max-h-[40%] shrink-0 @min-[44rem]/servers:max-h-none" : "flex-1"}`}
        >
          {loaded && servers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-3 py-8 text-center text-sm">
              <Server aria-hidden className="size-6 text-(--ui-text-muted)" />
              <p className="font-medium">{t("No machines connected.")}</p>
              <p className="max-w-sm text-(--ui-text-muted)">
                {t("Add an SSH server for terminal access, or a machine running bycoda Host.")}
              </p>
            </div>
          ) : null}
          {servers.length > 0 && filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-(--ui-text-muted)">
              <p>{t("No matching servers.")}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setGroup("");
                  setTag("");
                  setFavoritesOnly(false);
                  setRecentFirst(false);
                }}
              >
                {t("Reset filters")}
              </Button>
            </div>
          ) : null}
          <div className="mbe-3 hidden items-center justify-between gap-2 text-xs text-(--ui-text-muted) @min-[44rem]/servers:flex">
            <span>
              {t("Servers")} <span className="tabular-nums">({filtered.length})</span>
            </span>
            {group ? <span className="truncate">{group}</span> : null}
          </div>
          <ul
            aria-label={t("Servers")}
            data-servers-layout={layout}
            className={
              layout === "cards"
                ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] content-start gap-2"
                : "flex flex-col gap-0.5"
            }
          >
            {filtered.map((server) => (
              <ServerItem
                key={server.id}
                server={server}
                address={address(server)}
                layout={layout}
                selected={selectedId === server.id}
                accent={serverAccentColor(server)}
                canConnect={canConnect(server)}
                onSelect={() => setSelectedId(server.id)}
                onConnect={() => connect(server)}
                onMenu={(at) => openServerMenu(server.id, at)}
              />
            ))}
          </ul>
        </div>
        {selected ? (
          <section
            aria-label={t("Server details")}
            className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-stroke @min-[44rem]/servers:w-[min(45%,28rem)] @min-[44rem]/servers:flex-none @min-[44rem]/servers:border-t-0 @min-[44rem]/servers:border-s"
          >
            <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-stroke px-4 py-3">
              <Server aria-hidden className="size-4 shrink-0 text-(--ui-text-muted)" />
              <h2 className="min-w-0 flex-1 truncate text-base font-medium" title={selected.name}>
                {selected.name}
              </h2>
              {selected.kind === "ssh" ? <Badge size="sm">SSH</Badge> : null}
              {selected.machine || selected.kind === "ssh" ? (
                <Button
                  variant="ghost"
                  iconOnly
                  label={t(selected.kind === "ssh" ? "Edit SSH server" : "Edit machine")}
                  onClick={() =>
                    selected.kind === "ssh" ? setEditor(selected) : requestMachineEdit(selected.id)
                  }
                >
                  <Pencil aria-hidden className="size-3.5" />
                </Button>
              ) : null}
              {selected.machine ? <ReconnectAction machine={selected.machine} /> : null}
              <Button
                variant="ghost"
                iconOnly
                label={t("Server actions")}
                aria-haspopup="menu"
                aria-expanded={menu?.serverId === selected.id}
                onClick={(event) => openServerMenu(selected.id, event.currentTarget)}
              >
                <MoreHorizontal aria-hidden className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                iconOnly
                label={t("Close server details")}
                onClick={() => {
                  setSelectedId(undefined);
                  Array.from(
                    list.current?.querySelectorAll<HTMLButtonElement>("[data-server-row]") ?? [],
                  )
                    .find((row) => row.dataset.serverRow === selected.id)
                    ?.focus({ preventScroll: true });
                }}
              >
                <X aria-hidden className="size-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selected.machine ? (
                <div className="mbe-3">
                  <MachineStatus key={selected.id} machine={selected.machine} details />
                </div>
              ) : null}
              <dl className="mbs-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                <dt className="text-(--ui-text-muted)">{t("Address")}</dt>
                <dd className="break-all">{address(selected)}</dd>
                {selected.machine?.ssh || selected.sshEndpoint ? (
                  <>
                    <dt className="text-(--ui-text-muted)">{t("SSH port")}</dt>
                    <dd>
                      {selected.effectiveSshEndpoint?.port ??
                        selected.sshEndpoint?.port ??
                        selected.machine?.ssh?.port ??
                        22}
                    </dd>
                    {selected.machine?.ssh ? (
                      <>
                        <dt className="text-(--ui-text-muted)">{t("Host service port")}</dt>
                        <dd>{selected.machine.ssh.remotePort}</dd>
                      </>
                    ) : null}
                  </>
                ) : null}
              </dl>
              <ServersConnectionTools
                key={selected.id}
                server={selected}
                servers={servers}
                onUseServer={setSelectedId}
                onEditServer={(existing) => {
                  setSelectedId(existing.id);
                  setEditor(existing);
                }}
              />
            </div>
          </section>
        ) : loaded && servers.length > 0 ? (
          <div className="hidden min-h-0 min-w-0 flex-col items-center justify-center gap-2 border-s border-stroke p-4 text-center @min-[44rem]/servers:flex @min-[44rem]/servers:w-[min(45%,28rem)] @min-[44rem]/servers:flex-none">
            <Server aria-hidden className="size-5 text-(--ui-text-muted)" />
            <h2 className="text-sm font-medium">{t("Select a server")}</h2>
            <p className="max-w-xs text-xs text-(--ui-text-muted)">
              {t(
                "Select a server to view details. Double-click or press Enter to connect via SSH.",
              )}
            </p>
          </div>
        ) : null}
      </div>
      {menuServer && menu ? (
        <ContextMenu
          {...(menu.at instanceof HTMLElement
            ? { anchor: menu.at }
            : { x: menu.at.x, y: menu.at.y })}
          ariaLabel={menuServer.name}
          items={menuItems(menuServer)}
          onPick={(id) => pickMenuItem(menuServer, id, menu.at)}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
      {colorServer && colorTarget ? (
        <Popover
          anchor={colorTarget.at}
          align="start"
          width={248}
          role="dialog"
          aria-label={t("Server color")}
          onDismiss={() => setColorTarget(undefined)}
        >
          <ServerColorPopover
            server={colorServer}
            onPick={(patch) => saveColor(colorServer.id, patch)}
          />
        </Popover>
      ) : null}
      {deleteTarget ? (
        <Popover
          anchor={deleteTarget.at}
          align="start"
          width={280}
          role="dialog"
          aria-label={t("Delete {p0}?", { p0: deleteTarget.server.name })}
          onDismiss={() => {
            if (!deleting) setDeleteTarget(undefined);
          }}
        >
          <div className="flex flex-col gap-3 p-3 text-sm">
            <p className="font-medium">{t("Delete {p0}?", { p0: deleteTarget.server.name })}</p>
            <p className="text-xs text-(--ui-text-muted)">
              {deleteTarget.server.kind === "ssh"
                ? t("Removes this SSH server from bycoda. The remote machine is not changed.")
                : t(
                    "Removes this machine from this desktop only. The host and its sessions keep running.",
                  )}
            </p>
            <ConfirmMorph
              label={t("Delete")}
              icon={<Trash2 aria-hidden className="size-3.5" />}
              tone="danger"
              confirmMode="press"
              disabled={deleting != null}
              onConfirm={() => deleteServer(deleteTarget.server)}
              onStateChange={(state) => {
                if (state === "done") setDeleteTarget(undefined);
              }}
              onCancel={() => setDeleteTarget(undefined)}
            />
          </div>
        </Popover>
      ) : null}
      {quickConnect ? <QuickConnect onClose={() => setQuickConnect(false)} /> : null}
      {termiusImport ? (
        <TermiusImportDialog servers={servers} onClose={() => setTermiusImport(false)} />
      ) : null}
      {sshSettings ? (
        <SshSettings
          servers={servers}
          onClose={() => setSshSettings(false)}
          onUseServer={setSelectedId}
          onEditServer={(server) => {
            setSelectedId(server.id);
            setEditor(server);
          }}
        />
      ) : null}
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
