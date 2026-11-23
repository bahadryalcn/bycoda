import { useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { InlineTextAction } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { CollectionFooter, ContinuousList } from "../../../shared/ui/ContinuousList";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { Popover } from "../../../shared/ui/Popover";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select as SharedSelect } from "../../../shared/ui/Select";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Group, Row, SettingsFeedback } from "../../../shared/ui/settings";
import { Globe, MonitorSmartphone, Plus, RefreshCw, Server } from "../../../shared/ui/icons";
import { useRemoteMachines } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { parseRemotePath, remoteProjectFor } from "../../connections/public/remoteProjects";
import type { RecentProject } from "../../projects";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import { useMcpHub } from "../hooks/useMcpHub";
import {
  canSignInMcp,
  isMcpConnected,
  MCP_PROVIDER_LABELS,
  needsMcpSignIn,
  scopeLabel,
  type McpConnection,
  type McpLoadingPolicy,
} from "../model/mcp";
import {
  buildMcpCatalog,
  mcpEntryLabel,
  mcpEntrySearchText,
  mcpEntryStatus,
  type McpCatalogEntry,
  type McpEntryStatus,
} from "../model/mcpCatalog";
import {
  describeMcpConfigWarnings,
  getCachedMcpSettings,
  invalidateMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
  type McpServerRow,
  type McpSettingsSnapshot,
} from "../model/mcpSettingsCache";
import { invokeMcpConfig, type RemoteMcpConfigTarget } from "../model/mcpConfigTarget";
import { AddServerModal, PROVIDERS, scopeDescription, type Provider } from "./McpAddServer";
import {
  McpServerDetail,
  sourceLabel,
  STATUS_TONE,
  statusLabel,
  type McpRowActions,
} from "./McpServerDetail";
import styles from "./McpSettings.module.css";

type Scope = McpConnection["scope"];
type ProviderFilter = "all" | Provider | "host";
type StatusFilter = "all" | "sign-in" | "off";
const serverRowKey = (server: McpServerRow) =>
  `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;
const canToggleMcp = (server: McpServerRow) =>
  !!server.configPath && ["claude", "codex", "opencode"].includes(server.provider);

/** A missing provider CLI is an install step, not a failed sign-in. */
function actionErrorText(cause: unknown, provider?: Provider): string {
  const text = String(cause);
  if (provider && /CLI not found/i.test(text)) {
    return provider === "cursor"
      ? t(
          "Cursor CLI (cursor-agent) is not installed. Install it to sign in from here, or sign in to this server inside Cursor.",
        )
      : t("{p0} CLI is not installed. Install it to sign in from here.", {
          p0: MCP_PROVIDER_LABELS[provider],
        });
  }
  return text;
}

export function McpSettings({ cwd, recents = [] }: { cwd: string; recents?: RecentProject[] }) {
  useLocale();
  const [view, setView] = useRetainedState<"global" | "project">("mcp:view", "global");
  const globalOnly = view === "global";
  const [selection, setSelection] = useState({ initialCwd: cwd, project: cwd });
  const project = selection.initialCwd === cwd ? selection.project : cwd;
  const [globalMachineId, setGlobalMachineId] = useRetainedState("mcp:machine", "");
  const inventory = useRemoteMachines();
  const machines = inventory.machines.filter((machine) => !isLocalSyncMachine(machine));
  const source = parseRemotePath(project);
  const projectRecord = source ? remoteProjectFor(project) : undefined;
  const machine = globalOnly
    ? machines.find((item) => item.id === globalMachineId)
    : source && machines.find((item) => item.environmentId === source.environmentId);
  const needsRemote = globalOnly ? globalMachineId !== "" : !!source;
  const remote = machine
    ? {
        machineId: machine.id,
        environmentId: machine.environmentId,
        projectId: globalOnly ? undefined : projectRecord?.projectId,
      }
    : undefined;
  const machineName = machine?.name ?? t("This computer");
  const targetError =
    needsRemote && !machine
      ? t("This computer is no longer available in Connections.")
      : source && !globalOnly && !projectRecord
        ? t("Open this project from Connections to manage its MCP servers.")
        : "";
  const targetCwd = globalOnly ? "~" : (source?.hostPath ?? project);
  const remoteMachineId = remote?.machineId;
  const remoteProjectId = remote?.projectId;
  const projectPicker = (disabled = false) => (
    <div className={styles.scopeControls}>
      <SegmentedControl
        label={t("Scope")}
        value={view}
        onValueChange={(value) => setView(value as "global" | "project")}
        options={[
          { value: "global", label: t("Global"), disabled, icon: <Globe className="icon-sm" /> },
          { value: "project", label: t("Project"), disabled },
        ]}
      />
      {globalOnly ? (
        <SharedSelect
          hideLabel
          label={t("Computer")}
          value={globalMachineId || "local"}
          disabled={disabled}
          options={[
            {
              value: "local",
              label: t("This computer"),
              icon: <MonitorSmartphone className="icon-sm" />,
            },
            ...machines.map((item) => ({
              value: item.id,
              label: item.name,
              icon: <Server className="icon-sm" />,
            })),
            ...(globalMachineId && !machine
              ? [{ value: globalMachineId, label: t("Unavailable machine"), disabled: true }]
              : []),
          ]}
          onValueChange={(id) => setGlobalMachineId(id === "local" ? "" : id)}
        />
      ) : (
        <>
          <SearchableProjectPicker
            cwd={project}
            railCwd={cwd}
            recents={recents}
            chooseLabel={t("Choose project")}
            disabled={disabled}
            appearance="filled"
            className="w-fit max-w-full min-w-0"
            buttonClassName="max-w-full"
            onSelectProject={(path) => setSelection({ initialCwd: cwd, project: path })}
          />
          <Text size="caption" tone="secondary" className="inline-flex items-center gap-1.5">
            {needsRemote ? (
              <Server className="icon-sm" />
            ) : (
              <MonitorSmartphone className="icon-sm" />
            )}
            {machine?.name ?? (needsRemote ? source?.environmentId : machineName)}
          </Text>
        </>
      )}
    </div>
  );
  return (
    <div className="settings-topics">
      {targetError ? (
        <div
          className={styles.connections}
          id="setting-mcp-servers"
          data-setting-id="mcp-servers"
          tabIndex={-1}
        >
          {projectPicker()}
          {needsRemote && !machine && inventory.loading ? (
            <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
          ) : (
            <SettingsFeedback
              state="error"
              action={{ label: t("Retry"), onClick: inventory.refresh }}
            >
              {inventory.error || targetError}
            </SettingsFeedback>
          )}
        </div>
      ) : (
        <McpConnections
          key={JSON.stringify([
            targetCwd,
            view,
            remoteMachineId,
            remote?.environmentId,
            remoteProjectId,
          ])}
          cwd={targetCwd}
          globalOnly={globalOnly}
          projectPicker={projectPicker}
          remote={remote}
          machineName={machineName}
        />
      )}
    </div>
  );
}

function McpConnections({
  cwd,
  globalOnly,
  projectPicker,
  remote,
  machineName,
}: {
  cwd: string;
  globalOnly: boolean;
  projectPicker: (disabled?: boolean) => ReactNode;
  remote?: RemoteMcpConfigTarget;
  machineName: string;
}) {
  useLocale();
  const cached = getCachedMcpSettings(cwd, globalOnly, remote);
  const [servers, setServers] = useState<McpServerRow[]>(cached?.servers ?? []);
  const stateKey = `mcp-connections:${remote?.machineId ?? "local"}:${pathKey(cwd)}:${globalOnly ? "global" : "project"}`;
  const [providerFilter, setProviderFilter] = useRetainedState<ProviderFilter>(
    `${stateKey}:filter`,
    "all",
  );
  const [statusFilter, setStatusFilter] = useRetainedState<StatusFilter>(
    `${stateKey}:status`,
    "all",
  );
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [selected, setSelected] = useState<McpCatalogEntry | null>(null);
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(!cached);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [error, setError] = useState(cached?.error ?? "");
  const [configWarnings, setConfigWarnings] = useState(cached?.configWarnings ?? []);
  const [claudeError, setClaudeError] = useState(cached?.claudeError ?? "");
  const [claudeChecking, setClaudeChecking] = useState(cached?.claudeChecking ?? false);
  const [claudePartial, setClaudePartial] = useState(cached?.claudePartial ?? false);
  const [nativeConfigAvailable, setNativeConfigAvailable] = useState(cached?.nativeConfigAvailable);
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [removeTarget, setRemoveTarget] = useState<McpServerRow | null>(null);
  const [removeScope, setRemoveScope] = useState<Scope>("local");
  const refreshGeneration = useRef(0);
  const hub = useMcpHub(cwd, globalOnly, remote);

  function applySnapshot(snapshot: McpSettingsSnapshot) {
    setServers(snapshot.servers);
    setError(snapshot.error);
    setConfigWarnings(snapshot.configWarnings ?? []);
    setClaudeError(snapshot.claudeError);
    setClaudeChecking(snapshot.claudeChecking ?? false);
    setClaudePartial(snapshot.claudePartial ?? false);
    setNativeConfigAvailable(snapshot.nativeConfigAvailable);
    setLoading(false);
  }

  // Reason: the shared discovery cache publishes health and Codex auth after the list; mirror it here.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- subscribes to the shared MCP discovery store for this view
  useEffect(
    () => subscribeMcpSettings(cwd, applySnapshot, globalOnly, remote),
    [cwd, globalOnly, remote],
  );

  async function refresh(force = true, checkResult = false) {
    const generation = ++refreshGeneration.current;
    const previous = getCachedMcpSettings(cwd, globalOnly, remote);
    if (force) invalidateMcpSettings(cwd, remote);
    setLoading(force || !previous);
    const [snapshot] = await Promise.all([
      loadMcpSettings(cwd, force, { claudeHealth: force, globalOnly, remote }),
      force ? hub.refresh() : Promise.resolve(),
    ]);
    if (generation === refreshGeneration.current)
      applySnapshot(getCachedMcpSettings(cwd, globalOnly, remote) ?? snapshot);
    if (checkResult && snapshot.error) throw new Error(snapshot.error);
  }

  // Reason: read discovery once per view; later reads come from Refresh or a configuration change.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads provider discovery for this view; generation drops stale results
  useEffect(() => {
    void refresh(false);
    return () => {
      refreshGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is recreated per render; the view identity is the key
  }, [cwd, globalOnly]);

  // Until Claude reports health, a configured Claude row is unknown, not signed out.
  const pendingHealth = (row: McpServerRow) =>
    (claudeChecking || loading) && row.provider === "claude" && row.status === "Configured";
  const catalog = buildMcpCatalog(servers, hub.loading, hub.oauth);
  const statusOf = (entry: McpCatalogEntry): McpEntryStatus =>
    mcpEntryStatus(
      entry,
      (row) => isMcpConnected(row.status),
      (row) => !pendingHealth(row) && needsMcpSignIn(row),
    );
  const providerOptions = PROVIDERS.filter((provider) =>
    catalog.some((entry) => entry.configs.some((config) => config.provider === provider)),
  );
  const hasHostOnly = catalog.some((entry) => entry.configs.length === 0);
  const search = query.trim().toLocaleLowerCase();
  const visible = catalog.filter((entry) => {
    if (providerFilter === "host" && entry.configs.length > 0) return false;
    if (
      providerFilter !== "all" &&
      providerFilter !== "host" &&
      !entry.configs.some((config) => config.provider === providerFilter)
    )
      return false;
    const status = statusOf(entry);
    if (statusFilter === "sign-in" && status !== "sign-in" && status !== "expired") return false;
    if (statusFilter === "off" && status !== "off") return false;
    return (
      !search ||
      mcpEntrySearchText(
        entry,
        (row) => `${MCP_PROVIDER_LABELS[row.provider]} ${scopeLabel(row.scope)}`,
      ).includes(search)
    );
  });
  const activeFilters = (providerFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);
  const resetFilters = () => {
    setProviderFilter("all");
    setStatusFilter("all");
    setQuery("");
  };
  const signInCount = catalog.filter((entry) => {
    const status = statusOf(entry);
    return status === "sign-in" || status === "expired";
  }).length;

  async function run(server: McpServerRow, action: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(`${serverRowKey(server)}:${action}`);
    setActionError("");
    try {
      await work();
    } catch (cause) {
      setActionError(actionErrorText(cause, server.provider));
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  const canToggle = (server: McpServerRow) =>
    canToggleMcp(server) && !(globalOnly && server.provider === "claude");

  const actions: McpRowActions = {
    locked: loading || busy !== "",
    busyKey: busy,
    canToggle,
    toggleBlockedReason: (server) =>
      canToggle(server)
        ? undefined
        : globalOnly && server.provider === "claude"
          ? t("Select a project to change Claude Code permissions.")
          : t("{p0} does not support turning servers off here.", {
              p0: MCP_PROVIDER_LABELS[server.provider],
            }),
    refresh: () => refresh(),
    setEnabled: (server) =>
      run(server, "toggle", async () => {
        if (!canToggle(server)) return;
        await invokeMcpConfig(
          "mcp_set_enabled",
          {
            cwd,
            provider: server.provider,
            name: server.name,
            scope: server.scope,
            configPath: server.configPath,
            enabled: server.enabled === false,
            expectedEnabled: server.enabled !== false,
            ...(globalOnly ? { globalOnly: true } : {}),
          },
          remote,
        );
        await refresh();
      }),
    providerSignIn: (server) =>
      run(server, "login", async () => {
        if (!canSignInMcp(server)) return;
        if (remote) return;
        await invokeMcpConfig("mcp_provider_login", {
          cwd,
          provider: server.provider,
          name: server.name,
        });
        await refresh();
      }),
    remove: async (server) => {
      if (!server.configPath) {
        setRemoveScope("local");
        setRemoveTarget(server);
        return;
      }
      const confirmed = await confirmInApp({
        title: t("Remove MCP server?"),
        message: t(
          "“{p0}” is removed from the {p1} scope. Conversations that use it lose its tools; you can add it again later.",
          { p0: server.name, p1: scopeLabel(server.scope) },
        ),
        confirmLabel: t("Remove server"),
        tone: "danger",
      });
      if (!confirmed) return;
      await run(server, "remove", async () => {
        await invokeMcpConfig(
          "claude_mcp_remove",
          {
            cwd,
            name: server.name,
            scope: server.scope,
            ...(remote ? { configPath: server.configPath } : {}),
          },
          remote,
        );
        await refresh();
      });
    },
  };

  /** The quick action asks for the sign-in that unblocks sessions first: bycoda's own, then the provider's. */
  function quickSignIn(entry: McpCatalogEntry) {
    const hubEntry = entry.hub;
    if (hubEntry?.kind === "http" && hubEntry.oauth !== "signed-in")
      return () => void hub.signIn(hubEntry.name);
    if (remote) return undefined;
    const row = entry.configs.find((config) => !pendingHealth(config) && needsMcpSignIn(config));
    return row ? () => void actions.providerSignIn(row) : undefined;
  }

  const current = selected && catalog.find((entry) => entry.name === selected.name);
  const open = current ?? selected;
  const policy = hub.loading?.policy;
  const checkingServers = loading || (!!remote && hub.pending);
  return (
    <div
      id="setting-mcp-servers"
      data-setting-id="mcp-servers"
      tabIndex={-1}
      className={styles.connections}
    >
      <div className={styles.header}>
        {projectPicker(busy !== "" || hub.saving || !!hub.busy)}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            iconOnly
            label={t("Refresh")}
            loading={loading}
            disabled={loading || busy !== ""}
            onClick={() => void refresh()}
          >
            <RefreshCw className="icon-sm" />
          </Button>
          <Button
            variant="primary"
            disabled={
              hub.pending ||
              (!!remote &&
                (loading || (!hub.manageServer && (!!error || nativeConfigAvailable === false))))
            }
            disabledReason={
              hub.pending || (!!remote && loading)
                ? t("Checking servers…")
                : t("Server settings are unavailable on this computer.")
            }
            onClick={() => setAddOpen(true)}
          >
            <Plus className="icon-sm" />
            <span>{t("Add server")}</span>
          </Button>
        </div>
      </div>
      {nativeConfigAvailable === false ? (
        <SettingsFeedback state="warning">
          {t("Install the updated bycoda desktop app on {p0} to edit provider configuration.", {
            p0: machineName,
          })}
        </SettingsFeedback>
      ) : null}
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchInput
            appearance="field"
            aria-label={t("Search MCP servers")}
            type="search"
            placeholder={t("Search MCP servers")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterTrigger
          ref={filterAnchor}
          label={t("Filters")}
          activeCount={activeFilters}
          onReset={resetFilters}
          resetLabel={t("Reset filters")}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        />
        {signInCount > 0 && statusFilter === "all" ? (
          <Button size="sm" variant="ghost" onClick={() => setStatusFilter("sign-in")}>
            <StatusDot tone="warning" />
            {t("{p0} need sign-in", { p0: signInCount })}
          </Button>
        ) : null}
      </div>
      {filtersOpen ? (
        <Popover
          anchor={filterAnchor}
          kind="dialog"
          aria-label={t("Filter MCP servers")}
          variant="panel"
          width={360}
          onDismiss={() => setFiltersOpen(false)}
        >
          <div className={styles.filterPanel}>
            <SectionLabel as="h3">{t("Source")}</SectionLabel>
            <SegmentedControl
              label={t("Filter MCP servers by source")}
              selectionRole="pressed"
              value={providerFilter}
              onValueChange={(value) => setProviderFilter(value as ProviderFilter)}
              options={[
                { value: "all", label: t("All") },
                ...providerOptions.map((provider) => ({
                  value: provider,
                  label: MCP_PROVIDER_LABELS[provider],
                })),
                ...(hasHostOnly ? [{ value: "host", label: t("Plugins and accounts") }] : []),
              ]}
            />
            <SectionLabel as="h3">{t("Status")}</SectionLabel>
            <SegmentedControl
              label={t("Filter MCP servers by status")}
              selectionRole="pressed"
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { value: "all", label: t("All") },
                { value: "sign-in", label: t("Needs sign-in") },
                { value: "off", label: t("Off") },
              ]}
            />
          </div>
        </Popover>
      ) : null}
      {actionError ? (
        <InlineError
          details={actionError}
          secondaryAction={{ label: t("Dismiss"), onClick: () => setActionError("") }}
        />
      ) : null}
      {error ? (
        <InlineError details={error} retry={{ onRetry: () => void refresh(), pending: loading }}>
          {servers.length ? t("Showing the last successful result.") : undefined}
        </InlineError>
      ) : null}
      {configWarnings.length ? (
        <InlineError
          details={describeMcpConfigWarnings(configWarnings)}
          retry={{ onRetry: () => void refresh(), pending: loading }}
        >
          {t("Some MCP configuration files could not be read, so their servers are not listed.")}
        </InlineError>
      ) : null}
      {claudeError ? (
        <InlineError details={claudeError}>
          {t("Claude connection status unavailable.")}
        </InlineError>
      ) : claudePartial ? (
        <SettingsFeedback state="warning">
          {t(
            "Claude did not finish checking every server in time. Servers it did not reach show Configured.",
          )}
        </SettingsFeedback>
      ) : null}
      {checkingServers && catalog.length === 0 ? (
        <SettingsFeedback state="loading">{t("Checking servers…")}</SettingsFeedback>
      ) : visible.length === 0 ? (
        search || activeFilters ? (
          <EmptyState
            size="inline"
            context="list"
            kind="filtered"
            onReset={resetFilters}
            title={t("No MCP servers match your search.")}
          />
        ) : error || configWarnings.length || (!!remote && hub.error) ? null : (
          // With unreadable files the warning above explains the empty list; "none configured" would be false.
          <EmptyState
            size="inline"
            context="list"
            title={t("No MCP servers configured. Add a server or choose another project.")}
          />
        )
      ) : (
        <div role="region" aria-label={t("MCP servers")}>
          <Surface variant="card" frame="card" radius="card" padding="none">
            <ContinuousList
              rowAppearance="settings"
              className={styles.list}
              items={visible}
              itemKey={(entry) => entry.name}
              stateKey={`${stateKey}:${providerFilter}:${statusFilter}`}
              estimateSize={40}
              renderItem={(entry) => {
                const status = statusOf(entry);
                const signIn =
                  status === "sign-in" || status === "expired" ? quickSignIn(entry) : undefined;
                const sources = entry.configs.length
                  ? [
                      ...new Set(
                        entry.configs.map(
                          (config) =>
                            `${MCP_PROVIDER_LABELS[config.provider]}${config.scope === "user" ? "" : ` (${scopeLabel(config.scope)})`}`,
                        ),
                      ),
                    ]
                  : (entry.hub?.sources ?? []).map(sourceLabel);
                return (
                  <CollectionRow
                    key={entry.name}
                    leading={
                      <StatusDot
                        tone={status === "off" ? "muted" : STATUS_TONE[status]}
                        label={statusLabel(status)}
                      />
                    }
                    title={mcpEntryLabel(entry)}
                    secondary={sources.join(" · ")}
                    trailing={
                      <>
                        {entry.hub?.direct && policy?.mode === "onDemand" ? (
                          <Badge size="xs" tone="neutral">
                            {t("Starts with session")}
                          </Badge>
                        ) : null}
                        {/* The dot carries the quiet default; only an exception is written. */}
                        {status === "configured" ? null : statusLabel(status)}
                      </>
                    }
                    action={
                      signIn ? (
                        <InlineTextAction
                          reveal="always"
                          disabled={actions.locked || !!hub.busy}
                          onClick={signIn}
                        >
                          {t("Sign in")}
                        </InlineTextAction>
                      ) : undefined
                    }
                    onOpen={() => setSelected(entry)}
                    primary={{ "aria-label": t("Open {p0}", { p0: mcpEntryLabel(entry) }) }}
                  />
                );
              }}
            />
          </Surface>
        </div>
      )}
      <CollectionFooter loading={loading && catalog.length > 0} />
      {hub.waiting ? (
        <SettingsFeedback state="loading" immediate>
          {t("Finish signing in in your browser…")}
        </SettingsFeedback>
      ) : null}
      {hub.error && !open ? (
        <InlineError
          details={hub.error}
          secondaryAction={{ label: t("Dismiss"), onClick: hub.dismissError }}
        />
      ) : null}
      <Group
        title={t("Session startup")}
        info={
          <>
            <p>{t("Applies to new sessions on {p0}.", { p0: machineName })}</p>
            <p>
              {t("When needed: a server starts the first time a session uses one of its tools.")}
            </p>
            <p>{t("With every session: all servers start when a session opens.")}</p>
            <p>{t("Open a server to start just that one with every session.")}</p>
          </>
        }
        feedback={
          hub.loading?.corrupt ? (
            <SettingsFeedback state="error">
              {t(
                "The MCP loading file is unreadable, so servers load on demand. Repair it to save changes.",
              )}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <Row
          id="mcp-loading"
          label={t("Start MCP servers")}
          disabled={!policy || hub.saving || !!hub.loading?.corrupt}
        >
          <SharedSelect
            hideLabel
            label={t("Start MCP servers")}
            value={policy?.mode ?? "onDemand"}
            disabled={!policy || hub.saving || !!hub.loading?.corrupt}
            onValueChange={(mode) => void hub.setMode(mode as McpLoadingPolicy["mode"])}
            options={[
              { value: "onDemand", label: t("When needed") },
              { value: "always", label: t("With every session") },
            ]}
          />
        </Row>
      </Group>
      {open ? (
        <McpServerDetail
          entry={open}
          status={statusOf(open)}
          cwd={cwd}
          globalOnly={globalOnly}
          remote={remote}
          machineName={machineName}
          hub={hub}
          actions={actions}
          stale={!current}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {removeTarget ? (
        <Modal
          title={t("Remove MCP server?")}
          size="sm"
          onClose={() => {
            if (!busyRef.current) setRemoveTarget(null);
          }}
          footer={
            <>
              <Button
                disabled={busy !== ""}
                onClick={() => setRemoveTarget(null)}
              >
                {t("Cancel")}
              </Button>
              <Button
                tone="danger"
                loading={busy !== ""}
                onClick={() =>
                  void run(removeTarget, "remove", async () => {
                    await invokeMcpConfig(
                      "claude_mcp_remove",
                      {
                        cwd,
                        name: removeTarget.name,
                        scope: removeScope,
                      },
                      remote,
                    );
                    setRemoveTarget(null);
                    await refresh();
                  })
                }
              >
                {t("Remove server")}
              </Button>
            </>
          }
        >
          <p>
            {t(
              "“{p0}” is removed from the {p1} scope. Conversations that use it lose its tools; you can add it again later.",
              { p0: removeTarget.name, p1: scopeLabel(removeScope) },
            )}
          </p>
          <SharedSelect
            label={t("Scope to remove {p0} from", { p0: removeTarget.name })}
            disabled={busy !== ""}
            value={removeScope}
            onValueChange={(value) => setRemoveScope(value as Scope)}
            options={(["local", "project", "user"] as const).map((scope) => ({
              value: scope,
              label: scopeLabel(scope),
              description: scopeDescription(scope),
            }))}
          />
          {actionError ? <InlineError details={actionError} /> : null}
        </Modal>
      ) : null}
      {addOpen ? (
        <AddServerModal
          cwd={cwd}
          globalOnly={globalOnly}
          remote={remote}
          machineName={machineName}
          manageServer={hub.manageServer}
          providerAvailable={nativeConfigAvailable !== false && (!remote || !error)}
          initialProvider={
            providerFilter === "all" || providerFilter === "host" ? "claude" : providerFilter
          }
          onClose={() => setAddOpen(false)}
          onAdded={() => refresh(true, true)}
        />
      ) : null}
    </div>
  );
}
