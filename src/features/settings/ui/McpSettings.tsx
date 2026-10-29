import { SettingsFeedback } from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
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
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { revealPath } from "../../../platform/tauri/fs";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import type { RecentProject } from "../../projects/model/recents";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import styles from "./McpSettings.module.css";
import { ExternalMcpAccess } from "./ExternalMcpAccess";
import { Modal } from "../../../shared/ui/Modal";
import { Popover } from "../../../shared/ui/Popover";
import { Globe, Plus, RefreshCw, ListFilter, Trash2, FileScript } from "../../../shared/ui/icons";
import { MCP_PROVIDER_LABELS, type McpConnection } from "../model/mcp";
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
type Provider = McpConnection["provider"];
const PROVIDERS: Provider[] = ["claude", "claude_desktop", "codex", "cursor", "opencode"];
const BATCH_SIZE = 16;
const SCOPES: Record<Provider, Scope[]> = {
  claude: ["local", "project", "user"],
  claude_desktop: ["user"],
  codex: ["user"],
  cursor: ["project", "user"],
  opencode: ["project", "user"],
};

function scopeLabel(scope: Scope): string {
  return scope === "user" ? t("Personal") : scope === "project" ? t("Project") : t("Local project");
}

function scopeDescription(scope: Scope): string {
  return scope === "user"
    ? t("Personal: applies across projects for this provider on this machine.")
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
    >
      <form onSubmit={(event) => void add(event)} className="space-y-4 p-4">
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
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={busy} disabled={busy}>
            {t("Add server")}
          </Button>
        </div>
      </form>
    </Modal>
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
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [removeScopes, setRemoveScopes] = useState<Record<string, Scope>>({});
  const refreshGeneration = useRef(0);

  const applySnapshot = useCallback((snapshot: McpSettingsSnapshot) => {
    setServers(snapshot.servers);
    setError(snapshot.error);
    setClaudeError(snapshot.claudeError);
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
  }, [effectiveFilter, servers, query]);
  // The revealed page size belongs to the current filter and query and starts over when either changes.
  const revealKey = `${effectiveFilter}
${query}`;
  const visibleCount = reveal.key === revealKey ? reveal.count : BATCH_SIZE;
  const revealMore = useCallback(
    (limit: number) =>
      setReveal((current) => ({
        key: revealKey,
        count: Math.min((current.key === revealKey ? current.count : BATCH_SIZE) + BATCH_SIZE, limit),
      })),
    [revealKey],
  );
  const pageServers = visible.slice(0, visibleCount);
  useEffect(() => {
    if (!continuation.current || !listRoot.current || visibleCount >= visible.length || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!cancelled && entries.some((entry) => entry.isIntersecting)) revealMore(visible.length);
    }, { root: listRoot.current, rootMargin: "160px" });
    observer.observe(continuation.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [visible.length, visibleCount, revealMore]);

  async function login(server: ServerRow) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ server: serverRowKey(server), action: "login" });
    setError("");
    try {
      await invoke("mcp_provider_login", {
        cwd,
        provider: server.provider,
        name: server.name,
      });
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function remove(server: ServerRow) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ server: serverRowKey(server), action: "remove" });
    const selectedScope = server.configPath ? server.scope : (removeScopes[server.name] ?? "local");
    setError("");
    try {
      if (
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
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div id="setting-mcp-servers" data-setting-id="mcp-servers" tabIndex={-1} className={styles.connections}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-ui-title font-medium">{t("MCP connections")}</h2>
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
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextField
            label={t("Search MCP servers")}
            hideLabel
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
          selected={effectiveFilter !== "all" || showAllProviders}
          aria-expanded={filtersOpen}
          aria-haspopup="dialog"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <ListFilter className="icon-sm" />
        </Button>
        {effectiveFilter !== "all" ? (
          <span className={styles.filterLabel}>{MCP_PROVIDER_LABELS[effectiveFilter]}</span>
        ) : null}
      </div>
      {filtersOpen ? (
        <Popover
          anchor={filterAnchor}
          role="dialog"
          aria-label={t("Filter MCP servers by provider")}
          width={300}
          onDismiss={() => setFiltersOpen(false)}
        >
          <div className={styles.filterPanel}>
            <h3>{t("Provider")}</h3>
            <div
              role="group"
              className={styles.providers}
              aria-label={t("Filter MCP servers by provider")}
            >
              {(["all", ...filterProviders] as const).map((provider) => (
                <Button
                  key={provider}
                  variant="tab"
                  motion="none"
                  type="button"
                  aria-pressed={effectiveFilter === provider}
                  onClick={() => setFilter(provider)}
                >
                  {provider === "all" ? (
                    <Globe className="icon-sm" />
                  ) : (
                    <ProviderIcon provider={provider} />
                  )}
                  {provider === "all" ? t("All") : MCP_PROVIDER_LABELS[provider]}
                  <span>
                    {provider === "all"
                      ? servers.length
                      : servers.filter((server) => server.provider === provider).length}
                  </span>
                </Button>
              ))}
            </div>
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
              disabled={effectiveFilter === "all" && !showAllProviders && !query}
              onClick={() => {
                setFilter("all");
                setQuery("");
                setShowAllProviders(false);
              }}
            >
              {t("Reset filters")}
            </Button>
          </div>
        </Popover>
      ) : null}
      {error ? <SettingsFeedback state="error" action={<Button loading={loading} onClick={() => void refresh()}>{t("Retry")}</Button>}>{servers.length ? `${t("Showing the last successful result.")} ` : ""}{error}</SettingsFeedback> : null}
      {claudeError && (effectiveFilter === "all" || effectiveFilter === "claude") ? (
        <SettingsFeedback state="warning">
          {t("Claude connection status unavailable: ")} {claudeError}
        </SettingsFeedback>
      ) : null}
      {loading && servers.length === 0 ? (
        <SettingsFeedback state="loading">{t("Checking servers…")}</SettingsFeedback>
      ) : visible.length === 0 && !error ? (
        <SettingsFeedback state="empty">
          {query.trim()
            ? t("No MCP servers match your search.")
            : effectiveFilter === "all"
              ? t("No MCP servers configured. Add a server or choose another project.")
              : t("No MCP servers configured for this provider.")}
        </SettingsFeedback>
      ) : (
        <div ref={listRoot} className={styles.list} role="region" aria-label={t("MCP connections")} tabIndex={0}>
          {pageServers.map((server) => (
            <div key={serverRowKey(server)} className={styles.row}>
              <span className={styles.providerIcon}>
                <ProviderIcon provider={server.provider} />
              </span>
              <div className={styles.identity}>
                <div className={styles.name} title={server.name}>
                  {server.name}
                </div>
              </div>
              <Badge
                className={styles.status}
                tone={
                  /needs authentication/i.test(server.status)
                    ? "warning"
                    : /failed|error|disconnected/i.test(server.status)
                      ? "danger"
                      : /^(?:✔\s*)?connected$/i.test(server.status.trim())
                        ? "success"
                        : "neutral"
                }
              >
                {server.status}
              </Badge>
              <section className={styles.details}>
                <h3
                  title={t("Connection details")}
                  aria-label={`${t("Connection details")}: ${server.name}`}
                >
                  <span className={styles.metadata}>
                    {MCP_PROVIDER_LABELS[server.provider]} &#183; {scopeLabel(server.scope)} &#183;{" "}
                    {server.transport || "MCP"}
                  </span>
                </h3>
                <details className={styles.disclosure}>
                  <summary>{t("Connection details")}</summary>
                  <div className={styles.detailContent}>
                    {server.provider === "claude" ? <p>{t("Claude CLI status is matched by server name; it is not verified separately for each scope.")}</p> : null}
                    {server.configPath ? (
                      <span className={styles.path}>{server.configPath}</span>
                    ) : (
                      <p>{scopeDescription(server.scope)}</p>
                    )}
                    {server.provider !== "claude" ? (
                      <p>
                        {server.configPath
                          ? t("Edit or remove this entry in its provider configuration.")
                          : t(
                              "Configuration path unavailable. Open this provider's settings to manage the entry.",
                            )}
                      </p>
                    ) : null}
                  </div>
                </details>
              </section>
              <div className={styles.actions}>
                {server.provider !== "claude_desktop" &&
                server.transport &&
                !["stdio", "local", "ws"].includes(server.transport) ? (
                  <Button
                    type="button"
                    loading={busy?.server === serverRowKey(server) && busy.action === "login"}
                    disabled={loading || busy !== null}
                    onClick={() => void login(server)}
                  >
                    {t("Sign in")}
                  </Button>
                ) : null}
                {server.provider === "claude" ? (
                  <>
                    {!server.configPath ? (
                      <label className="text-ui-caption text-(--ui-text-muted)">
                        {t("Scope")}{" "}
                        <SharedSelect
                          disabled={loading || busy !== null}
                          label={t("Scope to remove {p0} from", { p0: server.name })}
                          value={removeScopes[server.name] ?? "local"}
                          onValueChange={(value) =>
                            setRemoveScopes((current) => ({
                              ...current,
                              [server.name]: value as Scope,
                            }))
                          }
                          options={[
                            { value: "local", label: t("Local project") },
                            { value: "project", label: t("Project") },
                            { value: "user", label: t("Personal") },
                          ]}
                        />
                      </label>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      tone="danger"
                      iconOnly
                      label={t("Remove")}
                      tooltip={`${t("Remove")}: ${server.name} · ${scopeLabel(server.scope)}`}
                      disabled={loading || busy !== null}
                      loading={busy?.server === serverRowKey(server) && busy.action === "remove"}
                      onClick={() => void remove(server)}
                    >
                      <Trash2 className="icon-sm" />
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    label={t("Show config")}
                    tooltip={`${t("Show config")}: ${server.name}`}
                    disabled={!server.configPath}
                    onClick={() =>
                      void revealPath(server.configPath).catch((cause) => setError(String(cause)))
                    }
                  >
                    <FileScript className="icon-sm" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {visibleCount < visible.length ? <div ref={continuation} className={styles.continuation}>
            <Button variant="ghost" onClick={() => revealMore(visible.length)}>{t("Show more connections")}</Button>
          </div> : null}
        </div>
      )}
      {visible.length > 0 ? (
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
            { p0: (() => {
              const server = servers.find((entry) => serverRowKey(entry) === busy.server);
              return server ? `${t(busy.action === "login" ? "Sign in" : "Remove")}: ${server.name} · ${MCP_PROVIDER_LABELS[server.provider]} · ${scopeLabel(server.scope)}` : busy.server;
            })() },
          )}
        </p>
      ) : null}
      <AdvancedSettings
        id="mcp-scopes"
        settingIds={["mcp-scopes"]}
        title={t("Advanced: scopes and connection status")}
      >
        <div className="space-y-2 text-ui-caption text-(--ui-text-secondary)">
          {[
            scopeDescription("local"),
            scopeDescription("project"),
            scopeDescription("user"),
          ].map((description) => <p key={description}>{description}</p>)}
        </div>
        <p className="text-ui-caption text-(--ui-text-muted)">
          {t(
            "Claude Code status comes from its CLI. Other providers show configured entries. Sign in opens your browser when supported.",
          )}
        </p>
      </AdvancedSettings>
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
