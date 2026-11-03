import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { SettingsFeedback } from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select as SharedSelect } from "../../../shared/ui/Select";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t, useLocale } from "../../../shared/i18n";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { invoke } from "@tauri-apps/api/core";
import { confirmInApp } from "../../../shared/model/appConfirm";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { revealPath } from "../../../platform/tauri/fs";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import type { RecentProject } from "../../projects/model/recents";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import styles from "./McpSettings.module.css";
import { ExternalMcpAccess } from "./ExternalMcpAccess";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Popover } from "../../../shared/ui/Popover";
import { Globe, Plus, RefreshCw, ListFilter, MoreHorizontal } from "../../../shared/ui/icons";
import {
  canSignInMcp,
  isMcpConnected,
  MCP_PROVIDER_LABELS,
  needsMcpSignIn,
  type McpConnection,
} from "../model/mcp";
import { AdvancedSettings, Row } from "./settingsControls";
import {
  getCachedMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
  MCP_LOCAL_ONLY_ERROR,
  type McpServerRow,
  type McpSettingsSnapshot,
} from "../model/mcpSettingsCache";

type Scope = McpConnection["scope"];
type ServerRow = McpServerRow;
const serverRowKey = (server: ServerRow) =>
  `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;
type Filter = "all" | McpConnection["provider"];
type ScopeFilter = "all" | Scope;

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
type Provider = McpConnection["provider"];
const PROVIDERS: Provider[] = ["claude", "claude_desktop", "codex", "cursor", "opencode"];
const BATCH_SIZE = 16;
const SCOPES: Record<Provider, Scope[]> = {
  claude: ["user", "project", "local"],
  claude_desktop: ["user"],
  codex: ["user"],
  cursor: ["project", "user"],
  opencode: ["project", "user"],
};

function scopeLabel(scope: Scope): string {
  return scope === "user" ? t("Global") : scope === "project" ? t("Project") : t("Local project");
}

function scopeDescription(scope: Scope): string {
  return scope === "user"
    ? t("Global: applies to every project for this provider on this machine.")
    : scope === "project"
      ? t(
          "Project: saved in the selected project's provider configuration; it may be shared with the project.",
        )
      : t(
          "Local project: applies only to the selected project in your personal Claude configuration.",
        );
}

function ProviderIcon({ provider }: { provider: Provider }) {
  useLocale();
  return (
    <HarnessIcon
      harness={provider === "claude_desktop" ? "claude" : provider}
      className="size-3.5 shrink-0"
    />
  );
}

function McpPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <SharedSelect
      loopNavigation
      disabled={disabled}
      label={label}
      value={value}
      options={options}
      onValueChange={(value) => onChange(value as T)}
    />
  );
}

function AddServerModal({
  cwd,
  initialProvider,
  onClose,
  onAdded,
}: {
  cwd: string;
  initialProvider: Provider;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  useLocale();
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [scope, setScope] = useState<Scope>(SCOPES[initialProvider][0]);
  const [name, setName] = useState("");
  const [config, setConfig] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const adding = useRef(false);
  const formId = useId();

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding.current) return;
    adding.current = true;
    try {
      const parsed: unknown = JSON.parse(config);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("Configuration must be a JSON object"));
      }
      setBusy(true);
      setError("");
      await invoke("mcp_add", {
        cwd,
        provider,
        scope,
        name: name.trim(),
        config,
      });
      await onAdded();
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("Add MCP server")}
      description={t("Paste a server configuration and choose where to add it.")}
      onClose={() => {
        if (!adding.current) onClose();
      }}
      fitViewport
      footer={
        <ModalActions>
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form={formId}
            loading={busy}
            disabled={busy}
          >
            {t("Add server")}
          </Button>
        </ModalActions>
      }
    >
      <form id={formId} onSubmit={(event) => void add(event)} className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <McpPicker
            disabled={busy}
            label={t("Provider")}
            value={provider}
            options={PROVIDERS.map((option) => ({
              value: option,
              label: MCP_PROVIDER_LABELS[option],
              icon: <ProviderIcon provider={option} />,
            }))}
            onChange={(next) => {
              setProvider(next);
              setScope(SCOPES[next][0]);
            }}
          />
          <McpPicker
            disabled={busy}
            label={t("Scope")}
            value={scope}
            options={SCOPES[provider].map((option) => ({
              value: option,
              label: scopeLabel(option),
            }))}
            onChange={setScope}
          />
        </div>
        <p className="text-ui-caption text-(--ui-text-secondary)" role="status">
          {MCP_PROVIDER_LABELS[provider]} · {scopeDescription(scope)}
        </p>
        <p className="break-all text-ui-caption text-(--ui-text-muted)">
          {t("Selected project: {p0}", { p0: cwd })}
        </p>
        <label className="block text-ui-caption text-(--ui-text-secondary)">
          {t("Name")}{" "}
          <span className="text-(--ui-text-muted)">{t("(optional for an mcpServers block)")}</span>
          <TextField
            hideLabel
            label={t("Name")}
            value={name}
            disabled={busy}
            pattern={provider === "opencode" ? undefined : "[A-Za-z0-9_-]*"}
            onChange={(event) => setName(event.target.value)}

            placeholder={t("my-server")}
          />
        </label>
        <label className="block text-ui-caption text-(--ui-text-secondary)">
          {t("JSON configuration")}
          <TextareaField
            hideLabel
            label={t("JSON configuration")}
            required
            value={config}
            disabled={busy}
            onChange={(event) => setConfig(event.target.value)}
            rows={7}
            spellCheck={false}

            placeholder={
              '{"mcpServers":{"my-server":{"command":"npx","args":["-y","example-mcp"]}}}'
            }
          />
        </label>
        <p className="text-ui-caption text-(--ui-text-muted)">
          {t(
            "Paste one entry from an mcpServers block, or a single server object with a name above.",
          )}
        </p>
        <AdvancedSettings title={t("Advanced: configuration requirements")}>
          <Row
            label={t("Before adding a server")}
            description={t(
              "Check the command or URL and required credentials. Adding saves configuration for the selected provider and scope; it does not confirm a working connection. Refresh to check available status.",
            )}
          />
        </AdvancedSettings>
        {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      </form>
    </Modal>
  );
}

/** A long provider message stays two lines until the reader asks for the rest. */
function ExpandableWarning({ children }: { children: ReactNode }) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = text.current;
    if (!node || expanded) return;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, children]);
  return (
    <SettingsFeedback
      state="warning"
      action={
        overflowing || expanded ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? t("Show less") : t("Show more")}
          </Button>
        ) : undefined
      }
    >
      <span ref={text} className={styles.clamp} data-expanded={expanded || undefined}>
        {children}
      </span>
    </SettingsFeedback>
  );
}

export function McpSettings({ cwd, recents = [] }: { cwd: string; recents?: RecentProject[] }) {
  useLocale();
  const [selection, setSelection] = useState({ initialCwd: cwd, project: cwd });
  const project = selection.initialCwd === cwd ? selection.project : cwd;
  const projectPicker = (
    <SearchableProjectPicker
      cwd={project}
      railCwd={cwd}
      recents={recents}
      localOnly
      className="w-fit max-w-full shrink-0"
      buttonClassName="max-w-full"
      onSelectProject={(path) => {
        if (!path.startsWith("remote://")) setSelection({ initialCwd: cwd, project: path });
      }}
    />
  );
  if (project.startsWith("remote://")) {
    return (
      <div className="grid min-w-0 gap-7">
        {projectPicker}
        <SettingsFeedback state="warning">{t(MCP_LOCAL_ONLY_ERROR)}</SettingsFeedback>
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-7">
      <McpConnections key={project} cwd={project} projectPicker={projectPicker} />
      <ExternalMcpAccess cwd={project} />
    </div>
  );
}

function McpConnections({ cwd, projectPicker }: { cwd: string; projectPicker: ReactNode }) {
  useLocale();
  const cached = getCachedMcpSettings(cwd);
  const [servers, setServers] = useState<ServerRow[]>(cached?.servers ?? []);
  const stateKey = `mcp-connections:${pathKey(cwd)}`;
  const [filter, setFilter] = useRetainedState<Filter>(`${stateKey}:filter`, "all");
  const [query, setQuery] = useRetainedState(`${stateKey}:query`, "");
  const [scopeFilter, setScopeFilter] = useRetainedState<ScopeFilter>(`${stateKey}:scope`, "all");
  const [actionError, setActionError] = useState("");
  const [reveal, setReveal] = useState({ key: "", count: BATCH_SIZE });
  const listRoot = useRef<HTMLDivElement>(null);
  const continuation = useRef<HTMLDivElement>(null);
  const [showAllProviders, setShowAllProviders] = useRetainedState(
    `${stateKey}:all-providers`,
    false,
  );
  const [loading, setLoading] = useState(!cached);
  const [busy, setBusy] = useState<{ server: string; action: "login" | "remove" } | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState(cached?.error ?? "");
  const [claudeError, setClaudeError] = useState(cached?.claudeError ?? "");
  const [claudeChecking, setClaudeChecking] = useState(cached?.claudeChecking ?? false);
  const [claudePartial, setClaudePartial] = useState(cached?.claudePartial ?? false);
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [removeTarget, setRemoveTarget] = useState<ServerRow | null>(null);
  const [removeScopes, setRemoveScopes] = useState<Record<string, Scope>>({});
  const removeScope = removeTarget ? (removeScopes[removeTarget.name] ?? "local") : "local";
  const [menu, setMenu] = useState<{ server: ServerRow; anchor: HTMLButtonElement } | null>(null);
  const refreshGeneration = useRef(0);

  const applySnapshot = useCallback((snapshot: McpSettingsSnapshot) => {
    setServers(snapshot.servers);
    setError(snapshot.error);
    setClaudeError(snapshot.claudeError);
    setClaudeChecking(snapshot.claudeChecking ?? false);
    setClaudePartial(snapshot.claudePartial ?? false);
    setLoading(false);
  }, []);

  useEffect(() => subscribeMcpSettings(cwd, applySnapshot), [cwd, applySnapshot]);

  const refresh = useCallback(
    async (force = true) => {
      const generation = ++refreshGeneration.current;
      const previous = getCachedMcpSettings(cwd);
      if (!force) {
        setServers(previous?.servers ?? []);
        setError(previous?.error ?? "");
        setClaudeError(previous?.claudeError ?? "");
        setClaudeChecking(previous?.claudeChecking ?? false);
        setClaudePartial(previous?.claudePartial ?? false);
      }
      setLoading(force || !previous);
      const snapshot = await loadMcpSettings(cwd, force);
      if (generation === refreshGeneration.current) {
        applySnapshot(getCachedMcpSettings(cwd) ?? snapshot);
      }
    },
    [cwd, applySnapshot],
  );

  useEffect(() => {
    void refresh(false);
    return () => {
      refreshGeneration.current += 1;
    };
  }, [refresh]);

  const filterProviders = showAllProviders
    ? PROVIDERS
    : PROVIDERS.filter(
        (provider) =>
          servers.some((server) => server.provider === provider) ||
          (provider === filter && (loading || !!error || !!claudeError)),
      );
  // A stored provider filter that no longer has servers falls back to "all" without rewriting it.
  const effectiveFilter: Filter =
    loading || error || claudeError || filter === "all" || filterProviders.includes(filter)
      ? filter
      : "all";
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return servers.filter(
      (server) =>
        (effectiveFilter === "all" || server.provider === effectiveFilter) &&
        (scopeFilter === "all" || server.scope === scopeFilter) &&
        (!search ||
          [
            server.name,
            MCP_PROVIDER_LABELS[server.provider],
            scopeLabel(server.scope),
            server.transport,
            server.status,
            server.configPath,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search)),
    );
  }, [effectiveFilter, scopeFilter, servers, query]);
  // The revealed page size belongs to the current filter and query and starts over when either changes.
  const revealKey = `${effectiveFilter}
${scopeFilter}
${query}`;
  const visibleCount = reveal.key === revealKey ? reveal.count : BATCH_SIZE;
  const revealMore = useCallback(
    (limit: number) =>
      setReveal((current) => ({
        key: revealKey,
        count: Math.min(
          (current.key === revealKey ? current.count : BATCH_SIZE) + BATCH_SIZE,
          limit,
        ),
      })),
    [revealKey],
  );
  const pageServers = visible.slice(0, visibleCount);
  useEffect(() => {
    if (
      !continuation.current ||
      !listRoot.current ||
      visibleCount >= visible.length ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!cancelled && entries.some((entry) => entry.isIntersecting)) revealMore(visible.length);
      },
      { root: listRoot.current, rootMargin: "160px" },
    );
    observer.observe(continuation.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [visible.length, visibleCount, revealMore]);

  async function login(server: ServerRow) {
    if (busyRef.current || !canSignInMcp(server)) return;
    busyRef.current = true;
    setBusy({ server: serverRowKey(server), action: "login" });
    setActionError("");
    try {
      await invoke("mcp_provider_login", {
        cwd,
        provider: server.provider,
        name: server.name,
      });
      await refresh();
    } catch (cause) {
      setActionError(actionErrorText(cause, server.provider));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function remove(server: ServerRow, confirmedScope?: Scope) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ server: serverRowKey(server), action: "remove" });
    const selectedScope = confirmedScope ?? server.scope;
    setActionError("");
    try {
      if (
        confirmedScope === undefined &&
        !(await confirmInApp({
          title: t("Remove MCP server?"),
          message: t(
            "“{p0}” is removed from the {p1} scope. Conversations that use it lose its tools; you can add it again later.",
            { p0: server.name, p1: scopeLabel(selectedScope) },
          ),
          confirmLabel: t("Remove server"),
          tone: "danger",
        }))
      )
        return;
      await invoke("claude_mcp_remove", {
        cwd,
        name: server.name,
        scope: selectedScope,
      });
      setRemoveTarget(null);
      await refresh();
    } catch (cause) {
      setActionError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div
      id="setting-mcp-servers"
      data-setting-id="mcp-servers"
      tabIndex={-1}
      className={styles.connections}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-ui-title font-medium">{t("MCP connections")}</h2>
            <span
              id="setting-mcp-scopes"
              data-setting-id="mcp-scopes"
              tabIndex={-1}
              className={styles.scopeHelp}
            >
              <InfoPopover label={t("Advanced: scopes and connection status")}>
                {[
                  scopeDescription("local"),
                  scopeDescription("project"),
                  scopeDescription("user"),
                ].map((description) => (
                  <p key={description}>{description}</p>
                ))}
                <p>
                  {t(
                    "Claude Code status comes from its CLI. Other providers show configured entries. Sign in opens your browser when supported.",
                  )}
                </p>
                <p>
                  {t(
                    "Claude CLI status is matched by server name; it is not verified separately for each scope.",
                  )}
                </p>
              </InfoPopover>
            </span>
            {projectPicker}
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            iconOnly
            label={t("Refresh")}
            loading={loading}
            onClick={() => void refresh()}
            disabled={loading || busy !== null}
          >
            <RefreshCw className="icon-sm" />
          </Button>
          <Button
            type="button"
            aria-label={t("Add MCP server")}
            variant="primary"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="icon-sm" />
            <span>{t("Add MCP server")}</span>
          </Button>
        </div>
      </div>
      {servers.length > 0 ||
      loading ||
      query ||
      effectiveFilter !== "all" ||
      scopeFilter !== "all" ||
      showAllProviders ? (
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
          <Button
            ref={filterAnchor}
            iconOnly
            label={t("Filters")}
            selected={effectiveFilter !== "all" || scopeFilter !== "all" || showAllProviders}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <ListFilter className="icon-sm" />
          </Button>
          {effectiveFilter !== "all" || scopeFilter !== "all" ? (
            <span className={styles.filterLabel}>
              {[
                effectiveFilter !== "all" ? MCP_PROVIDER_LABELS[effectiveFilter] : "",
                scopeFilter !== "all" ? scopeLabel(scopeFilter) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </div>
      ) : null}
      {filtersOpen ? (
        <Popover
          anchor={filterAnchor}
          role="dialog"
          aria-label={t("Filter MCP servers by provider")}
          width={360}
          onDismiss={() => setFiltersOpen(false)}
        >
          <div className={styles.filterPanel}>
            <h3>{t("Provider")}</h3>
            <SegmentedControl
              label={t("Filter MCP servers by provider")}
              selectionRole="pressed"
              value={effectiveFilter}
              onValueChange={(provider) => setFilter(provider as Filter)}
              options={(["all", ...filterProviders] as const).map((provider) => ({
                value: provider,
                label: provider === "all" ? t("All") : MCP_PROVIDER_LABELS[provider],
                icon:
                  provider === "all" ? (
                    <Globe className="icon-sm" />
                  ) : (
                    <ProviderIcon provider={provider} />
                  ),
                accessory: (
                  <Badge variant="count" size="xs" tone="neutral">
                    {provider === "all"
                      ? servers.length
                      : servers.filter((server) => server.provider === provider).length}
                  </Badge>
                ),
              }))}
            />
            <h3>{t("Scope")}</h3>
            <SegmentedControl
              label={t("Filter MCP servers by scope")}
              selectionRole="pressed"
              value={scopeFilter}
              onValueChange={(scope) => setScopeFilter(scope as ScopeFilter)}
              options={(["all", "user", "project", "local"] as const).map((scope) => ({
                value: scope,
                label: scope === "all" ? t("All") : scopeLabel(scope),
                accessory: (
                  <Badge variant="count" size="xs" tone="neutral">
                    {scope === "all"
                      ? servers.length
                      : servers.filter((server) => server.scope === scope).length}
                  </Badge>
                ),
              }))}
            />
            <Button
              variant="ghost"
              aria-label={
                showAllProviders ? t("Show available providers") : t("Show all providers")
              }
              aria-pressed={showAllProviders}
              onClick={() => setShowAllProviders(!showAllProviders)}
            >
              {showAllProviders ? t("Show available providers") : t("Show all providers")}
            </Button>
            <Button
              variant="secondary"
              disabled={
                effectiveFilter === "all" && scopeFilter === "all" && !showAllProviders && !query
              }
              onClick={() => {
                setFilter("all");
                setScopeFilter("all");
                setQuery("");
                setShowAllProviders(false);
              }}
            >
              {t("Reset filters")}
            </Button>
          </div>
        </Popover>
      ) : null}
      {actionError ? (
        <SettingsFeedback
          state="error"
          action={
            <Button variant="ghost" onClick={() => setActionError("")}>
              {t("Dismiss")}
            </Button>
          }
        >
          {actionError}
        </SettingsFeedback>
      ) : null}
      {error ? (
        <SettingsFeedback
          state="error"
          action={
            <Button loading={loading} onClick={() => void refresh()}>
              {t("Retry")}
            </Button>
          }
        >
          {servers.length ? `${t("Showing the last successful result.")} ` : ""}
          {error}
        </SettingsFeedback>
      ) : null}
      {claudeError && (effectiveFilter === "all" || effectiveFilter === "claude") ? (
        <ExpandableWarning>
          {t("Claude connection status unavailable: ")} {claudeError}
        </ExpandableWarning>
      ) : claudePartial && (effectiveFilter === "all" || effectiveFilter === "claude") ? (
        <SettingsFeedback state="warning">
          {t(
            "Claude did not finish checking every server in time. Servers it did not reach show Configured.",
          )}
        </SettingsFeedback>
      ) : null}
      {loading && servers.length === 0 ? (
        <SettingsFeedback state="loading">{t("Checking servers…")}</SettingsFeedback>
      ) : visible.length === 0 && !error ? (
        <SettingsFeedback
          state="empty"
          action={
            servers.length > 0 &&
            (query.trim() || effectiveFilter !== "all" || scopeFilter !== "all") ? (
              <Button
                onClick={() => {
                  setFilter("all");
                  setScopeFilter("all");
                  setQuery("");
                  setShowAllProviders(false);
                }}
              >
                {t("Reset filters")}
              </Button>
            ) : undefined
          }
        >
          {query.trim()
            ? t("No MCP servers match your search.")
            : effectiveFilter === "all"
              ? t("No MCP servers configured. Add a server or choose another project.")
              : t("No MCP servers configured for this provider.")}
        </SettingsFeedback>
      ) : (
        <div
          ref={listRoot}
          className={styles.list}
          role="region"
          aria-label={t("MCP connections")}
          tabIndex={0}
        >
          {pageServers.map((server) => {
            // Until Claude reports health, a configured Claude row is unknown, not signed out.
            const checking =
              claudeChecking && server.provider === "claude" && server.status === "Configured";
            return (
              <div key={serverRowKey(server)} className={styles.row}>
                <span className={styles.providerIcon}>
                  <ProviderIcon provider={server.provider} />
                </span>
                <div className={styles.identity}>
                  <div className={styles.nameLine}>
                    <OverflowTooltip label={server.name}>
                      <div className={styles.name}>{server.name}</div>
                    </OverflowTooltip>
                    <Badge
                      size="xs"
                      appearance="subtle"
                      tone={server.scope === "user" ? "info" : "neutral"}
                      className={styles.scopeTag}
                    >
                      {scopeLabel(server.scope)}
                    </Badge>
                  </div>
                </div>
                <span className={styles.status}>
                  <Badge
                    className={styles.statusBadge}
                    size="sm"
                    appearance="subtle"
                    tone={
                      checking
                        ? "neutral"
                        : /needs authentication/i.test(server.status)
                          ? "warning"
                          : /failed|error|disconnected/i.test(server.status)
                            ? "danger"
                            : isMcpConnected(server.status) || server.auth === "signed_in"
                              ? "success"
                              : "neutral"
                    }
                  >
                    {checking ? t("Checking…") : server.status}
                  </Badge>
                </span>
                <div className={styles.details}>
                  <p className={styles.metadata} title={server.configPath || undefined}>
                    {MCP_PROVIDER_LABELS[server.provider]} &#183; {server.transport || "MCP"}
                  </p>
                  {server.configPath ? (
                    <details className={styles.disclosure}>
                      <summary>{t("Connection details")}</summary>
                      <div className={styles.detailContent}>
                        <span className={styles.path}>{server.configPath}</span>
                        {server.provider === "claude" ? (
                          <p>
                            {t(
                              "Claude CLI status is matched by server name; it is not verified separately for each scope.",
                            )}
                          </p>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
                <div className={styles.rowActions}>
                  {!checking && needsMcpSignIn(server) ? (
                    <Button
                      stableWidth
                      type="button"
                      loading={busy?.server === serverRowKey(server) && busy.action === "login"}
                      disabled={loading || busy !== null}
                      onClick={() => void login(server)}
                    >
                      {t("Sign in")}
                    </Button>
                  ) : null}
                </div>
                <Button
                  className={styles.rowMenu}
                  type="button"
                  variant="ghost"
                  iconOnly
                  label={t("Actions for {p0}", { p0: server.name })}
                  tooltip={t("Actions for {p0}", { p0: server.name })}
                  aria-haspopup="menu"
                  aria-expanded={menu?.server === server}
                  disabled={loading || busy !== null}
                  loading={busy?.server === serverRowKey(server) && busy.action === "remove"}
                  onClick={(event) => setMenu({ server, anchor: event.currentTarget })}
                >
                  <MoreHorizontal className="icon-sm" />
                </Button>
              </div>
            );
          })}
          {visibleCount < visible.length ? (
            <div ref={continuation} className={styles.continuation}>
              <Button variant="ghost" onClick={() => revealMore(visible.length)}>
                {t("Show more connections")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {visibleCount < visible.length ? (
        <div className={styles.pagination}>
          <span role="status">
            {t("{p0}–{p1} of {p2} connections", {
              p0: 1,
              p1: Math.min(visibleCount, visible.length),
              p2: visible.length,
            })}
          </span>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="text-ui-caption text-(--ui-text-secondary)">
          {t(
            "Operation in progress for {p0}. Wait for the result before starting another operation.",
            {
              p0: (() => {
                const server = servers.find((entry) => serverRowKey(entry) === busy.server);
                return server
                  ? `${t(busy.action === "login" ? "Sign in" : "Remove")}: ${server.name} · ${MCP_PROVIDER_LABELS[server.provider]} · ${scopeLabel(server.scope)}`
                  : busy.server;
              })(),
            },
          )}
        </p>
      ) : null}
      {menu ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Actions for {p0}", { p0: menu.server.name })}
          onClose={() => setMenu(null)}
          items={[
            ...(canSignInMcp(menu.server) &&
            menu.server.auth !== "none" &&
            !needsMcpSignIn(menu.server)
              ? [
                  {
                    kind: "item" as const,
                    id: "login",
                    label: t("Sign in again"),
                    disabled: loading || busy !== null,
                  },
                ]
              : []),
            {
              kind: "item",
              id: "reveal",
              label: t("Show config"),
              disabled: !menu.server.configPath,
            },
            {
              kind: "item",
              id: "copy",
              label: t("Copy config path"),
              disabled: !menu.server.configPath,
            },
            {
              kind: "item",
              id: "remove",
              label: t("Remove"),
              danger: true,
              disabled: menu.server.provider !== "claude" || loading || busy !== null,
              description:
                menu.server.provider !== "claude" ? t("Edit in provider config") : undefined,
            },
          ]}
          onPick={(action) => {
            const server = menu.server;
            setMenu(null);
            if (action === "login") void login(server);
            if (action === "reveal")
              void revealPath(server.configPath).catch((cause) => setActionError(String(cause)));
            if (action === "copy")
              void copyText(server.configPath).catch((cause) => setActionError(String(cause)));
            if (action === "remove") {
              if (server.configPath) void remove(server);
              else {
                setRemoveTarget(server);
              }
            }
          }}
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
              <Button disabled={busy !== null} onClick={() => setRemoveTarget(null)}>
                {t("Cancel")}
              </Button>
              <Button
                tone="danger"
                loading={busy !== null}
                onClick={() => void remove(removeTarget, removeScope)}
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
            disabled={busy !== null}
            value={removeScope}
            onValueChange={(value) =>
              setRemoveScopes((current) => ({ ...current, [removeTarget.name]: value as Scope }))
            }
            options={[
              { value: "local", label: t("Local project") },
              { value: "project", label: t("Project") },
              { value: "user", label: t("Personal") },
            ]}
          />
          {actionError ? <SettingsFeedback state="error">{actionError}</SettingsFeedback> : null}
        </Modal>
      ) : null}
      {addOpen ? (
        <AddServerModal
          cwd={cwd}
          initialProvider={effectiveFilter === "all" ? "claude" : effectiveFilter}
          onClose={() => setAddOpen(false)}
          onAdded={refresh}
        />
      ) : null}
    </div>
  );
}
