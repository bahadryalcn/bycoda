import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Activity, useLayoutEffect, useRef, useState } from "react";
import { registerSshWorkspaceCatalog } from "../model/sshMobileWorkspaceControl";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { errorText } from "../../../shared/lib/errors";
import { copyWithFeedback, machineAddress } from "./serverActionFeedback";
import { t, useLocale } from "../../../shared/i18n";
import { RemoteActionError } from "./RemoteActionError";
import { describeRemoteError } from "../model/remoteFailure";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Divider } from "../../../shared/ui/Divider";
import { Sheet } from "../../../shared/ui/Sheet";
import "./ServersView.css";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ContextMenu, type ContextMenuItem } from "../../../shared/ui/ContextMenu";
import { Popover } from "../../../shared/ui/Popover";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { QuickConnect } from "./QuickConnect";
import {
  useOpenQuickServerTerminal,
  useOpenServerTerminal,
  useServerInventoryVisible,
} from "./ServersTerminalWorkspace";
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
  LayoutGrid,
  ListBullet,
  Plus,
  Server,
  ListFilter,
  X,
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
import { MachineStatus, ReconnectAction } from "./ServerStatus";
import { RemoteConnectionDetails } from "./RemoteConnectionDetails";
import { ServerItem, type ServerMenuAt } from "./ServerItem";
import { ServerColorPopover } from "./ServerColorPopover";
import { ServerIdentity } from "./ServerIdentity";
import { serverAccentColor } from "./serverColor";
import { useServersLayout, type ServersLayout } from "./serversLayout";

function ViewToggle({
  layout,
  onChange,
}: {
  layout: ServersLayout;
  onChange: (layout: ServersLayout) => void;
}) {
  useLocale();
  return (
    <SegmentedControl
      label={t("Server view")}
      value={layout}
      onValueChange={(next) => onChange(next as ServersLayout)}
      options={[
        {
          value: "list",
          label: t("List view"),
          icon: <ListBullet aria-hidden className="icon-sm" />,
          iconOnly: true,
        },
        {
          value: "cards",
          label: t("Card view"),
          icon: <LayoutGrid aria-hidden className="icon-sm" />,
          iconOnly: true,
        },
      ]}
    />
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
  const copyFeedback = useCopyFeedback();
  const { servers, loaded, loading, error, refresh } = useServerInventory();
  const openQuick = useOpenQuickServerTerminal();
  const openTerminal = useOpenServerTerminal();
  const inventoryVisible = useServerInventoryVisible();
  const [layout, setLayout] = useServersLayout();
  const [detailReady, setDetailReady] = useState(true);
  const detailOpenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Release the pointer inspection timer when the catalog unmounts so it cannot update an unmounted view.
  useLayoutEffect(() => () => clearTimeout(detailOpenTimer.current), []);
  const canConnect = (server: ServerRecord) =>
    Boolean(openTerminal && (server.kind === "ssh" || server.machine?.ssh));
  const connect = (server: ServerRecord) => {
    if (!canConnect(server)) return;
    clearTimeout(detailOpenTimer.current);
    setDetailReady(true);
    setSelectedId(server.id);
    void openTerminal?.(server).catch((reason) =>
      setFailure({
        title: t("Couldn’t open a terminal on {p0}", { p0: server.name }),
        error: errorText(reason),
        retry: () => connect(server),
      }),
    );
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
  const [colorTarget, setColorTarget] = useState<{
    serverId: string;
    at: ServerMenuAt;
  }>();
  const [deleteTarget, setDeleteTarget] = useState<{ server: ServerRecord }>();
  const [deleting, setDeleting] = useState<string>();
  // One failure: the title names what could not be done, and the retry belongs to this failure only.
  const [failure, setFailure] = useState<{ title: string; error: string; retry?: () => void }>();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkTargets, setBulkTargets] = useState<ServerRecord[]>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkLock = useRef(false);
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
  const mobileCatalog = useRef({ ready: false, servers: [] as ServerRecord[] });
  mobileCatalog.current = { ready: loaded && !loading && !error, servers: filtered };
  useLayoutEffect(() => registerSshWorkspaceCatalog(() => mobileCatalog.current), []);
  const selected = servers.find((server) => server.id === selectedId);
  const closeDetails = () => {
    clearTimeout(detailOpenTimer.current);
    setSelectedId(undefined);
    Array.from(list.current?.querySelectorAll<HTMLButtonElement>("[data-server-row]") ?? [])
      .find((row) => row.dataset.serverRow === selectedId)
      ?.focus({ preventScroll: true });
  };
  const menuServer = menu ? servers.find((server) => server.id === menu.serverId) : undefined;
  const colorServer = colorTarget
    ? servers.find((server) => server.id === colorTarget.serverId)
    : undefined;
  const filterCount = Number(!!group) + Number(!!tag) + Number(favoritesOnly);
  // Search, filters and the layout switch only mean something once there are servers to narrow.
  const showCollectionTools =
    !loaded || servers.length > 0 || !!search.trim() || filterCount > 0 || recentFirst;
  const resetNarrowing = () => {
    setSearch("");
    setGroup("");
    setTag("");
    setFavoritesOnly(false);
    setRecentFirst(false);
  };
  // Membership is separate from the inspected row. Hidden selections remain explicit.
  const checkedServers = servers.filter((server) => checkedIds.has(server.id));
  const visibleChecked = filtered.filter((server) => checkedIds.has(server.id)).length;
  const checkServer = (id: string, checked: boolean) =>
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const runBulk = async (targets: ServerRecord[], remove: boolean) => {
    if (bulkLock.current) return;
    bulkLock.current = true;
    setBulkBusy(true);
    setFailure(undefined);
    const failed: ServerRecord[] = [];
    const failures: string[] = [];
    try {
      for (const server of targets) {
        try {
          if (remove) {
            if (server.kind === "ssh") await removeSshConnection(server.id);
            else await disconnectMachine(server.id);
            setSelectedId((current) => (current === server.id ? undefined : current));
          } else await updateServerMetadata(server.id, { favorite: true });
          checkServer(server.id, false);
        } catch (reason) {
          failed.push(server);
          failures.push(`${server.name}: ${errorText(reason)}`);
        }
      }
      if (remove) setBulkTargets(failed.length ? failed : undefined);
      if (failures.length)
        setFailure({
          title: remove
            ? t("Couldn’t delete {p0} servers", { p0: failures.length })
            : t("Couldn’t favorite {p0} servers", { p0: failures.length }),
          error: failures.join("\n"),
        });
      return failures.join("\n");
    } finally {
      bulkLock.current = false;
      setBulkBusy(false);
    }
  };

  const runAction = async (work: () => Promise<unknown>, title: string) => {
    setFailure(undefined);
    try {
      await work();
    } catch (reason) {
      setFailure({
        title,
        error: errorText(reason),
        retry: () => void runAction(work, title),
      });
    }
  };
  const menuItems = (server: ServerRecord): ContextMenuItem[] => [
    {
      kind: "item",
      id: "select",
      label: t("Select"),
      disabled: bulkBusy || checkedIds.has(server.id),
    },
    ...(canConnect(server)
      ? [
          {
            kind: "item" as const,
            id: "connect",
            label: t("Connect"),
            icon: <Terminal aria-hidden className="icon-sm" />,
          },
        ]
      : []),
    {
      kind: "item",
      id: "details",
      label: t("Show details"),
      icon: <Info aria-hidden className="icon-sm" />,
    },
    {
      kind: "item",
      id: "edit",
      label: server.kind === "ssh" ? t("Edit SSH server") : t("Edit machine"),
      icon: <Pencil aria-hidden className="icon-sm" />,
    },
    {
      kind: "item",
      id: "favorite",
      label: server.metadata.favorite ? t("Unfavorite") : t("Favorite"),
      icon: (
        <Star
          aria-hidden
          className="icon-sm"
          fill={server.metadata.favorite ? "currentColor" : "none"}
        />
      ),
    },
    {
      kind: "item",
      id: "color",
      label: t("Color…"),
      icon: <Palette aria-hidden className="icon-sm" />,
    },
    {
      kind: "item",
      id: "copy",
      label: t("Copy address"),
      icon: <Copy aria-hidden className="icon-sm" />,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "delete",
      label: t("Delete"),
      icon: <Trash2 aria-hidden className="icon-sm" />,
      danger: true,
      disabled: bulkBusy,
    },
  ];
  const pickMenuItem = (server: ServerRecord, id: string, at: ServerMenuAt) => {
    setMenu(undefined);
    if (id === "select") {
      setSelectedId(undefined);
      checkServer(server.id, true);
    } else if (id === "connect") connect(server);
    else if (id === "details") setSelectedId(server.id);
    else if (id === "edit") {
      if (server.kind === "ssh") setEditor(server);
      else requestMachineEdit(server.id);
    } else if (id === "favorite")
      void runAction(
        () => updateServerMetadata(server.id, { favorite: !server.metadata.favorite }),
        t("Couldn’t update {p0}", { p0: server.name }),
      );
    else if (id === "color") setColorTarget({ serverId: server.id, at });
    else if (id === "copy")
      void runAction(
        () =>
          copyWithFeedback(copyFeedback.copyAsync, () =>
            navigator.clipboard.writeText(address(server)),
          ),
        t("Couldn’t copy the address of {p0}", { p0: server.name }),
      );
    else if (id === "delete") {
      setFailure(undefined);
      setDeleteTarget({ server });
    }
  };
  const openServerMenu = (serverId: string, at: ServerMenuAt) => setMenu({ serverId, at });
  // Deleting is not reversible: the question stays open until the store confirms, and a second press is ignored.
  const deleteServer = async (server: ServerRecord) => {
    if (deleting || bulkLock.current) return;
    setDeleting(server.id);
    setFailure(undefined);
    try {
      if (server.kind === "ssh") await removeSshConnection(server.id);
      else await disconnectMachine(server.id);
      setSelectedId((current) => (current === server.id ? undefined : current));
    } finally {
      // A failure is thrown to the confirmation, which shows it and offers another try.
      setDeleting(undefined);
    }
  };
  const saveColor = (serverId: string, patch: ServerMetadataPatch) =>
    void runAction(() => updateServerMetadata(serverId, patch), t("Couldn’t update the server"));
  return (
    <Text
      as="section"
      size="inherit"
      tone="primary"
      aria-label={t("Servers")}
      className="@container/servers flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <PaneHeader
        dragRegion
        chromeInset={!besideRail ? true : compactRail ? "compact" : false}
        className="select-none"
        leading={
          besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        }
        trailing={IS_MAC ? null : <WindowControls />}
      >
        <ToolHeader>
          <Text
            as="div"
            size="body"
            tone="inherit"
            className="flex min-w-0 flex-1 items-center gap-2 px-3"
          >
            <Server aria-hidden className="icon-sm shrink-0" tone="muted" />
            <Text size="inherit" tone="inherit" truncate>
              {t("Servers")}
            </Text>
          </Text>
        </ToolHeader>
      </PaneHeader>
      <div
        {...surfaceAttributes(
          { frame: "pane", edge: "bottom" },
          "flex flex-wrap items-center gap-2 px-3 py-2",
        )}
      >
        <div className="servers-search-actions flex min-w-0 basis-64 flex-1 items-center gap-2">
          {showCollectionTools ? (
            <>
              <SearchInput
                appearance="field"
                containerClassName="servers-search min-w-0 max-w-96 flex-1"
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
                selected={filterCount > 0 || recentFirst}
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <ListFilter aria-hidden className="icon-sm" />
                {filterCount > 0 ? (
                  <Text aria-hidden tone="inherit" className="tabular-nums">
                    {filterCount}
                  </Text>
                ) : null}
              </Button>
              {filtersOpen ? (
                <Popover
                  anchor={filtersAnchor}
                  align="end"
                  width={280}
                  kind="dialog"
                  aria-label={t("Server filters")}
                  variant="panel"
                  onDismiss={() => setFiltersOpen(false)}
                >
                  <div className="flex flex-col gap-3">
                    <SearchableSelect
                      hideLabel
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
                    <div {...surfaceAttributes({ frame: "pane", edge: "top" }, "pt-3")}>
                      <Switch
                        label={t("Recently used first")}
                        checked={recentFirst}
                        onCheckedChange={setRecentFirst}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      disabled={!filterCount && !recentFirst}
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
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={actionsAnchor}
            variant="primary"
            aria-expanded={actionsOpen}
            aria-haspopup="menu"
            startIcon={<Plus aria-hidden className="icon-sm" />}
            onClick={() => setActionsOpen(!actionsOpen)}
          >
            {t("Add")}
          </Button>
          {actionsOpen ? (
            <DropdownMenu
              anchor={actionsAnchor}
              label={t("Add")}
              items={[
                {
                  kind: "item",
                  id: "add-ssh",
                  label: t("Add SSH server"),
                  description: t("SSH terminal access"),
                },
                {
                  kind: "item",
                  id: "add-machine",
                  label: t("Add a computer"),
                  description: t("Connect a computer running bycoda Host"),
                },
                ...(openQuick
                  ? [{ kind: "item" as const, id: "quick-connect", label: t("Quick connect") }]
                  : []),
                { kind: "sep" },
                { kind: "item", id: "import-termius", label: t("Import from Termius") },
                { kind: "item", id: "ssh-settings", label: t("SSH settings") },
              ]}
              onClose={() => setActionsOpen(false)}
              onPick={(id) => {
                setActionsOpen(false);
                if (id === "add-ssh") setEditor("new");
                else if (id === "add-machine") requestMachineAdd();
                else if (id === "quick-connect") setQuickConnect(true);
                else if (id === "ssh-settings") setSshSettings(true);
                else setTermiusImport(true);
              }}
            />
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="px-3 py-2">
          <RemoteActionError
            title={
              loaded
                ? t("Couldn’t refresh servers. Showing last loaded data.")
                : t("Couldn’t load servers.")
            }
            error={describeRemoteError(error)}
            action={{ label: t("Retry"), pending: loading, onClick: refresh }}
          />
        </div>
      ) : null}
      {failure ? (
        <div className="px-3 pt-2">
          <RemoteActionError
            title={failure.title}
            error={describeRemoteError(failure.error)}
            action={failure.retry ? { label: t("Retry"), onClick: failure.retry } : undefined}
          />
        </div>
      ) : null}
      {loading && !loaded && !error ? <LoadingText inset="row">{t("Loading servers…")}</LoadingText> : null}
      {groups.length > 0 ? (
        <div
          aria-label={t("Group")}
          className="flex shrink-0 flex-wrap items-center gap-1 px-3 py-2"
        >
          <Button variant="ghost" pressed={!group} onClick={() => setGroup("")}>
            {t("All")}{" "}
            <Badge size="xs" variant="count">
              {servers.length}
            </Badge>
          </Button>
          {groups.map((name) => (
            <Button
              key={name}
              variant="ghost"
              pressed={group === name}
              onClick={() => setGroup(group === name ? "" : name)}
            >
              {name}
              <Badge size="xs" variant="count">
                {servers.filter((server) => server.metadata.group === name).length}
              </Badge>
            </Button>
          ))}
        </div>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col @min-[44rem]/servers:flex-row">
        <div
          ref={list}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="servers-catalog min-h-0 min-w-0 flex-1 overflow-y-auto p-2 @min-[44rem]/servers:p-3"
        >
          {loaded && servers.length === 0 ? (
            <EmptyState
              kind="empty"
              icon={<Server aria-hidden className="icon-lg" />}
              title={t("No servers yet.")}
              action={{ label: t("Add SSH server"), onClick: () => setEditor("new") }}
            />
          ) : null}
          {servers.length > 0 && filtered.length === 0 ? (
            <EmptyState
              context="panel"
              kind="filtered"
              icon={null}
              description={t("No matching servers")}
              onReset={resetNarrowing}
              resetLabel={t("Reset filters")}
            />
          ) : null}
          {checkedServers.length > 0 ? (
            <Text
              as="div"
              size="caption"
              tone="inherit"
              aria-busy={bulkBusy}
              {...surfaceAttributes(
                { variant: "reading-base" },
                "servers-selection-bar sticky top-0 z-1",
              )}
            >
              <Checkbox
                aria-label={t("Select visible servers")}
                disabled={!filtered.length || bulkBusy}
                checked={filtered.length > 0 && visibleChecked === filtered.length}
                indeterminate={visibleChecked > 0 && visibleChecked < filtered.length}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setCheckedIds((previous) => {
                    const next = new Set(previous);
                    for (const server of filtered) {
                      if (checked) next.add(server.id);
                      else next.delete(server.id);
                    }
                    return next;
                  });
                }}
              />
              <Text role="status" size="inherit">
                {t("{p0} selected", { p0: checkedServers.length })}
                {checkedServers.length > visibleChecked
                  ? ` · ${t("{p0} hidden", { p0: checkedServers.length - visibleChecked })}`
                  : ""}
              </Text>
              <Button variant="ghost" disabled={bulkBusy} onClick={() => setCheckedIds(new Set())}>
                {t("Clear selection")}
              </Button>
              <div className="ms-auto flex gap-1">
                <Button
                  variant="ghost"
                  disabled={bulkBusy}
                  onClick={() => void runBulk(checkedServers, false)}
                  startIcon={<Star className="icon-sm" />}
                >
                  {t("Favorite")}
                </Button>
                <Button
                  tone="danger"
                  disabled={bulkBusy}
                  onClick={() => {
                    setFailure(undefined);
                    setBulkTargets([...checkedServers]);
                  }}
                  startIcon={<Trash2 className="icon-sm" />}
                >
                  {t("Delete selected")}
                </Button>
              </div>
            </Text>
          ) : null}
          <ul
            aria-label={t("Servers")}
            data-servers-layout={layout}
            className={
              layout === "cards"
                ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] content-start gap-2"
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
                checked={checkedIds.has(server.id)}
                selectionMode={checkedServers.length > 0}
                busy={bulkBusy}
                onCheck={(checked) => {
                  setSelectedId(undefined);
                  checkServer(server.id, checked);
                }}
                accent={serverAccentColor(server)}
                canConnect={canConnect(server)}
                onSelect={(event) => {
                  clearTimeout(detailOpenTimer.current);
                  setSelectedId(server.id);
                  // Let the first pointer double-click finish before the catalog reflows.
                  // Keyboard and assistive activation open the details immediately.
                  const defer =
                    event.detail > 0 && canConnect(server) && !(selected && detailReady);
                  setDetailReady(!defer);
                  if (defer) detailOpenTimer.current = setTimeout(() => setDetailReady(true), 240);
                }}
                onConnect={() => connect(server)}
                onMenu={(at) => openServerMenu(server.id, at)}
              />
            ))}
          </ul>
        </div>
        {selected && detailReady ? (
          <Activity mode={inventoryVisible ? "visible" : "hidden"}>
            <Divider decorative className="@min-[44rem]/servers:hidden" />
            <Divider
              decorative
              orientation="vertical"
              className="hidden @min-[44rem]/servers:block"
            />
            <div className="servers-detail-pane relative min-h-0 min-w-0">
              <Sheet
                modal={false}
                role="region"
                anchor="container"
                surface="canvas"
                expanded
                escapeScope="[data-app-servers]"
                title={t("Server details")}
                motion="none"
                initialFocus={false}
                dismissOnOutside={false}
                padding="none"
                onClose={closeDetails}
                header={
                  <PaneHeader
                    leading={<ServerIdentity accent={serverAccentColor(selected)} />}
                    title={
                      <OverflowTooltip label={selected.name}>
                        <Text as="span" size="inherit" tone="inherit" truncate className="block">
                          {selected.name}
                        </Text>
                      </OverflowTooltip>
                    }
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          iconOnly
                          label={t("Server actions")}
                          aria-haspopup="menu"
                          aria-expanded={menu?.serverId === selected.id}
                          onClick={(event) => openServerMenu(selected.id, event.currentTarget)}
                        >
                          <MoreHorizontal aria-hidden className="icon-sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          iconOnly
                          label={t("Close server details")}
                          onClick={closeDetails}
                        >
                          <X aria-hidden className="icon-sm" />
                        </Button>
                      </>
                    }
                  />
                }
              >
                <div className="min-w-0 px-4 pbs-3 pbe-2">
                  {selected.machine ? (
                    <div className="mbe-3 flex flex-wrap items-start justify-between gap-2">
                      <MachineStatus
                        key={selected.id}
                        machine={selected.machine}
                        details
                        showDiagnostics={false}
                      />
                      <div className="flex shrink-0 items-center">
                        <ReconnectAction machine={selected.machine} />
                      </div>
                    </div>
                  ) : null}
                  <DescriptionList>
                    <DescriptionItem term={t("Address")} monospace>
                      {address(selected)}
                    </DescriptionItem>
                    {selected.machine?.ssh || selected.sshEndpoint ? (
                      <>
                        <DescriptionItem term={t("SSH port")}>
                          {selected.effectiveSshEndpoint?.port ??
                            selected.sshEndpoint?.port ??
                            selected.machine?.ssh?.port ??
                            22}
                        </DescriptionItem>
                        {selected.machine?.ssh ? (
                          <DescriptionItem term={t("Host service port")}>
                            {selected.machine.ssh.remotePort}
                          </DescriptionItem>
                        ) : null}
                      </>
                    ) : null}
                  </DescriptionList>
                </div>
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
                {selected.machine ? (
                  <Disclosure className="mx-4 mbe-4" size="sm" summary={t("Diagnostics")}>
                    <RemoteConnectionDetails environmentId={selected.machine.environmentId} />
                  </Disclosure>
                ) : null}
              </Sheet>
            </div>
          </Activity>
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
          kind="dialog"
          aria-label={t("Server color")}
          variant="panel"
          onDismiss={() => setColorTarget(undefined)}
        >
          <ServerColorPopover
            server={colorServer}
            onPick={(patch) => saveColor(colorServer.id, patch)}
          />
        </Popover>
      ) : null}
      {bulkTargets ? (
        <ConfirmDialog
          request={{
            title: t("Delete {p0} servers?", { p0: bulkTargets.length }),
            message: t(
              "Removes saved connections from bycoda. Machines and their running sessions are not deleted.",
            ),
            confirmLabel: t("Delete selected"),
            confirmDisabled: bulkBusy,
            onConfirm: async () => {
              const failure = await runBulk(bulkTargets, true);
              if (failure) throw new Error(failure);
            },
            details: (
              <ul className="max-h-48 overflow-auto">
                {bulkTargets.map((server) => (
                  <li key={server.id} className="py-1">
                    <Text as="span" size="inherit" tone="inherit" weight="medium">
                      {server.name}
                    </Text>
                    <Text wrap="anywhere" tone="muted" className="block">
                      {address(server)}
                    </Text>
                  </li>
                ))}
              </ul>
            ),
          }}
          onSettle={(confirmed) => {
            // runBulk owns successful removal and keeps only failed targets for retry.
            if (!confirmed && !bulkLock.current) setBulkTargets(undefined);
          }}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          request={{
            title: t("Delete {p0}?", { p0: deleteTarget.server.name }),
            message: t(
              "Removes saved connections from bycoda. Machines and their running sessions are not deleted.",
            ),
            details: <Text wrap="anywhere">{address(deleteTarget.server)}</Text>,
            confirmLabel: t("Delete"),
            onConfirm: () => deleteServer(deleteTarget.server),
          }}
          onSettle={() => setDeleteTarget(undefined)}
        />
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
    </Text>
  );
}
