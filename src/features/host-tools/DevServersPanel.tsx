import { EmptyState } from "../../shared/ui/EmptyState";
import { Alert } from "../../shared/ui/Alert";
import { NumberField } from "../../shared/ui/NumberField";
import { TextField } from "../../shared/ui/TextField";
import { Checkbox } from "../../shared/ui/Checkbox";
import { SearchInput } from "../../shared/ui/SearchInput";
import { useRetainedState } from "../../shared/hooks/useRetainedState";
import { pathKey } from "../../shared/lib/paths";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../shared/i18n/technical";
import { hostFeatureRequest } from "../connections/model/hostFeatureClient";
import { BrowserPanel } from "./BrowserPanel";
import { accessibleDevelopmentUrl } from "../connections/model/workspaceUrls";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ProjectTunnelDialog } from "../connections/ui/ProjectTunnelDialog";
import { ExplorerMenu } from "../files/ui/ExplorerMenu";
import { Button } from "../../shared/ui/Button";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import {
  AppWindow,
  CircleX,
  Copy,
  ExternalLink,
  Eye,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Share,
  Square,
  X,
} from "../../shared/ui/icons";
import type {
  DevServer,
  DevServerDetails,
  DevServerEndpoint,
  DevServerScan,
  DevServerStart,
  DevServerStartResult,
  DevServerStop,
  DevServerTarget,
} from "./devServerTypes";
import "./dev-servers.css";

type Intent = "details" | "stop" | "kill" | "restart";
type Launch = { input: DevServerStart; result?: DevServerStartResult; pending?: boolean };
const POLL_MS = 15_000;
const MAX_FAILURES = 3;
const stateLabels = {
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
};
const target = (server: DevServer, tree = false): DevServerTarget => ({
  id: server.id,
  identity: server.process
    ? { pid: server.process.pid, startedAt: server.process.startedAt }
    : undefined,
  tree,
});
const hasIdentity = (server: DevServer) =>
  !!server.process?.startedAt && Number.isInteger(server.process.pid) && server.process.pid > 0;
const canControl = (server: DevServer) => (server.process ? hasIdentity(server) : server.managed);
const endpointKey = (endpoint: DevServerEndpoint) => `${endpoint.address}:${endpoint.port}`;

/** Mounted only for the visible tool; a changed host owns a fresh request scope. */
export function DevServersPanel({ cwd, launch }: { cwd: string; launch?: Launch }) {
  return <ProjectDevServersPanel key={cwd} cwd={cwd} launch={launch} />;
}

function ProjectDevServersPanel({ cwd, launch }: { cwd: string; launch?: Launch }) {
  useLocale();
  const [scan, setScan] = useState<DevServerScan>();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useRetainedState(`dev-servers:${pathKey(cwd)}:search`, "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [details, setDetails] = useState<DevServerDetails>();
  const [intent, setIntent] = useState<Intent>("details");
  const [tree, setTree] = useState(false);
  const [requiresForce, setRequiresForce] = useState(false);
  const [logs, setLogs] = useState<{ available: boolean; output: string }>();
  const [preview, setPreview] = useState<string>();
  const [sharing, setSharing] = useState<string>();
  const [showStart, setShowStart] = useState(!!launch);
  const [name, setName] = useState(launch?.input.name ?? "");
  const [command, setCommand] = useState(launch?.input.command ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(launch?.input.cwd ?? "");
  const [port, setPort] = useState(launch?.input.expectedPort?.toString() ?? "");
  const [restartCommand, setRestartCommand] = useState("");
  const [restartCwd, setRestartCwd] = useState("");
  const [startResult, setStartResult] = useState<DevServerStartResult>();
  const alive = useRef(false);
  const pending = useRef(false);
  const scanFlight = useRef<Promise<boolean> | undefined>(undefined);
  const failures = useRef(0);
  const detailsPanel = useRef<HTMLElement>(null);
  const previewPanel = useRef<HTMLElement>(null);
  const startForm = useRef<HTMLFormElement>(null);
  const actionError = useRef<HTMLDivElement>(null);

  const reveal = (element: HTMLElement | null) => {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  };
  useEffect(() => {
    if (details) reveal(detailsPanel.current);
  }, [details, intent]);
  useEffect(() => {
    if (preview) reveal(previewPanel.current);
  }, [preview]);
  useEffect(() => {
    if (showStart) reveal(startForm.current);
  }, [showStart]);
  useEffect(() => {
    if (error) reveal(actionError.current);
  }, [error]);

  const request = <T,>(method: string, params: Record<string, unknown> = {}) =>
    hostFeatureRequest<T>(cwd, "dev.servers", `devServers.${method}`, params);
  const refresh = (force = false): Promise<boolean> => {
    if (scanFlight.current) return scanFlight.current;
    setScanning(true);
    const flight: Promise<boolean> = Promise.resolve().then(async () => {
      try {
        const result = await request<DevServerScan>("list", { refresh: force });
        if (!alive.current) return false;
        if (result.status === "error") throw new Error(result.error || t("Scan failed"));
        failures.current = 0;
        setScanError("");
        setScan(result);
        return true;
      } catch (cause) {
        if (!alive.current) return false;
        failures.current++;
        setScanError(cause instanceof Error ? cause.message : String(cause));
        if (failures.current >= MAX_FAILURES) setAutoRefresh(false);
        return false;
      } finally {
        if (scanFlight.current === flight) scanFlight.current = undefined;
        if (alive.current) setScanning(false);
      }
    });
    scanFlight.current = flight;
    return flight;
  };
  const action = async (work: () => Promise<unknown>) => {
    if (!alive.current || pending.current || launch?.pending) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // A mutation waits for discovery, but background discovery never disables
      // local preview/copy controls or removes the list under the user's scroll.
      await scanFlight.current;
      if (!alive.current) return;
      await work();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isHidden = () => document.visibilityState === "hidden";
    const poll = async () => {
      if (stopped || polling || isHidden()) return;
      polling = true;
      try {
        if (!pending.current && !scanFlight.current) await refresh();
      } finally {
        polling = false;
      }
      if (!stopped && !isHidden() && failures.current < MAX_FAILURES)
        timer = setTimeout(() => void poll(), POLL_MS * Math.min(4, 2 ** failures.current));
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") void poll();
    };
    if (scan) timer = setTimeout(() => void poll(), POLL_MS);
    else void poll();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
    // The wrapper remounts for a new project. Polls share one flight and wait
    // until the previous scan completes; hidden windows do no discovery work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);
  useEffect(() => {
    if (launch?.result) {
      setStartResult(launch.result);
      if (launch.result.server) void action(() => refresh(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.result]);

  const select = (server: DevServer, nextIntent: Intent) => {
    // Pin the server so a reordered rescan cannot move the pane away from a confirmation.
    setSelectedId(server.id);
    return action(async () => {
      const result = await request<DevServerDetails>("details", target(server, true));
      if (!alive.current) return;
      setDetails(result);
      setIntent(nextIntent);
      setTree(result.server.managed || nextIntent === "restart");
      setRequiresForce(false);
      setLogs(undefined);
      // Observed argv can lose shell quoting; only retained managed launch commands are templates.
      setRestartCommand(result.server.managed ? (result.server.command ?? "") : "");
      setRestartCwd(result.server.cwd ?? result.server.process?.cwd ?? "");
    });
  };
  const control = (operation: "stop" | "kill" | "restart") =>
    action(async () => {
      if (!details) return;
      const server = details.server;
      setScan(
        (value) =>
          value && {
            ...value,
            servers: value.servers.map((item) =>
              item.id === server.id ? { ...item, state: "stopping" } : item,
            ),
          },
      );
      const params = {
        ...target(server, tree),
        ...(operation === "restart" && !server.managed
          ? { command: restartCommand.trim(), cwd: restartCwd.trim() }
          : {}),
      };
      try {
        if (operation === "restart") {
          const result = await request<DevServerStartResult>("restart", params);
          if (!alive.current) return;
          setStartResult(result);
          setDetails(undefined);
        } else {
          const result = await request<DevServerStop>(operation, params);
          if (!alive.current) return;
          setRequiresForce(result.requiresForce);
          setNotice(
            result.message ??
              (result.requiresForce
                ? t("The process is still running. You can force terminate it.")
                : t("Server stopped.")),
          );
          if (!result.requiresForce) setDetails(undefined);
        }
        await refresh(true);
      } catch (cause) {
        // A failed request must not leave the row stuck in its optimistic state.
        if (alive.current) {
          setScan(
            (value) =>
              value && {
                ...value,
                servers: value.servers.map((item) => (item.id === server.id ? server : item)),
              },
          );
        }
        throw cause;
      }
    });
  const disabled = busy || !!launch?.pending;
  const query = search.trim().toLocaleLowerCase();
  const servers = scan?.servers ?? [];
  const visibleServers = servers.filter(
    (server) =>
      !query ||
      [
        server.name,
        server.process?.name,
        server.command,
        server.process?.command,
        server.cwd,
        server.process?.cwd,
        server.process?.pid,
        server.projectName,
        ...server.endpoints.flatMap((endpoint) => [endpoint.port, endpoint.url, endpoint.address]),
      ].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase()
          .includes(query),
      ),
  );
  // Selection survives rescans by id and falls back to the first visible server.
  const selected =
    [...visibleServers, ...(startResult?.conflict?.servers ?? [])].find(
      (server) => server.id === selectedId,
    ) ?? visibleServers[0];
  const endpoint =
    selected?.endpoints.find((item) => endpointKey(item) === selectedEndpoint) ??
    selected?.endpoints[0];
  // Confirmation state belongs to the server it was requested for, never the highlighted row.
  const selectedDetails =
    details && selected && details.server.id === selected.id ? details : undefined;
  const choose = (server: DevServer) => {
    setSelectedId(server.id);
    if (server.id === selected?.id) return;
    setSelectedEndpoint(undefined);
    setDetails(undefined);
    setIntent("details");
    setRequiresForce(false);
    setLogs(undefined);
    setMenu(null);
  };
  const openLocal = (server: DevServer, address: DevServerEndpoint) =>
    void action(async () => {
      await openUrl(
        await accessibleDevelopmentUrl(cwd, address.url, { server, endpoint: address }),
      );
    });
  const copyUrl = (server: DevServer, address: DevServerEndpoint) =>
    void accessibleDevelopmentUrl(cwd, address.url, { server, endpoint: address })
      .then((url) => navigator.clipboard.writeText(url))
      .then(
        () => {
          if (alive.current) setNotice(t("URL copied."));
        },
        (cause) => {
          if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
  const pickMenu = (id: string) => {
    setMenu(null);
    if (!selected) return;
    if (id === "host" && endpoint)
      void action(async () => {
        await request("openExternal", {
          ...target(selected),
          port: endpoint.port,
          address: endpoint.address,
        });
      });
    if (id === "share" && endpoint) setSharing(endpoint.url);
    if (id === "kill") void select(selected, "kill");
  };
  const renderServer = (server: DevServer) => (
    <li className="dev-server-row" key={server.id} aria-label={server.name}>
      <Button
        variant="item"
        className="dev-server-row-button"
        aria-pressed={server.id === selected?.id}
        onClick={() => choose(server)}
      >
        <span
          className="dev-server-state"
          data-state={server.state}
          role="status"
          title={t(stateLabels[server.state])}
        >
          {t(stateLabels[server.state])}
        </span>
        <strong className="dev-server-name">{server.name}</strong>
        <code className="dev-server-ports">
          {[...new Set(server.endpoints.map((item) => `:${item.port}`))].join(" ") ||
            t("No listening ports")}
        </code>
        <span className="host-tool-muted dev-server-meta">
          {server.process ? `PID ${server.process.pid}` : t("Process not started")}
          {" · "}
          {server.managed ? t("Managed") : t("External")}
        </span>
      </Button>
    </li>
  );
  const renderDetails = (current: DevServerDetails) => (
    <section
      ref={detailsPanel}
      tabIndex={-1}
      className="dev-server-details"
      aria-label={t("Selected process details")}
    >
      <div className="dev-server-heading">
        <h5>{t("Process details")}</h5>
        <Button
          variant="ghost"
          iconOnly
          label={t("Close details")}
          disabled={disabled}
          onClick={() => setDetails(undefined)}
        >
          <X size={16} aria-hidden />
        </Button>
      </div>
      <dl className="dev-server-metadata">
        <dt>{t("Process")}</dt>
        <dd>
          {current.server.process
            ? `${current.server.process.name} · PID ${current.server.process.pid}`
            : t("Process not started")}
        </dd>
        <dt>{t("Process identity")}</dt>
        <dd>
          {hasIdentity(current.server)
            ? current.server.process!.startedAt
            : t("Process identity unavailable; process control is disabled.")}
        </dd>
        <dt>{t("Command")}</dt>
        <dd>{current.server.command ?? current.server.process?.command ?? t("Unavailable")}</dd>
        <dt>{t("Working directory")}</dt>
        <dd>{current.server.cwd ?? current.server.process?.cwd ?? t("Unavailable")}</dd>
        <dt>{t("Affected ports")}</dt>
        <dd>
          {(tree ? current.affectedPorts : current.server.endpoints.map((item) => item.port)).join(
            ", ",
          ) || t("No listening ports")}
        </dd>
      </dl>
      {current.descendants.length ? (
        <>
          <p className="host-tool-muted">
            {t("Child processes")}:{" "}
            {current.descendants
              .map((process) => `${process.name} (PID ${process.pid})`)
              .join(", ")}
          </p>
          <label className="host-tool-check">
            <Checkbox
              disabled={disabled || intent === "restart"}
              checked={tree}
              onChange={(event) => setTree(event.target.checked)}
            />
            {t("Include this process's children")}
          </label>
        </>
      ) : null}
      {intent === "restart" && !current.server.managed ? (
        <div className="dev-server-form">
          <p className="host-tool-muted">
            {t("Define the exact command and working directory to restart this external server.")}
          </p>
          <label className="host-tool-field">
            {t("Restart command")}
            <TextField
              hideLabel
              label={t("Restart command")}
              value={restartCommand}
              disabled={disabled}
              onChange={(event) => setRestartCommand(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Restart working directory")}
            <TextField
              hideLabel
              label={t("Restart working directory")}
              value={restartCwd}
              disabled={disabled}
              onChange={(event) => setRestartCwd(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {intent !== "details" ? (
        <div className="dev-server-confirm">
          <p className="host-tool-muted">
            {t(
              "Review the affected ports before confirming. The host verifies process identity before sending a signal.",
            )}
          </p>
          <div className="dev-server-actions">
            {intent === "stop" && !requiresForce ? (
              <Button
                variant="danger"
                disabled={disabled || !canControl(current.server)}
                onClick={() => void control("stop")}
              >
                {t("Confirm graceful stop")}
              </Button>
            ) : null}
            {intent === "kill" || requiresForce ? (
              <Button
                variant="danger"
                disabled={disabled || !hasIdentity(current.server)}
                onClick={() => void control("kill")}
              >
                {t("Confirm force terminate")}
              </Button>
            ) : null}
            {intent === "restart" ? (
              <Button
                variant="primary"
                disabled={
                  disabled ||
                  !canControl(current.server) ||
                  (!current.server.managed && (!restartCommand.trim() || !restartCwd.trim()))
                }
                onClick={() => void control("restart")}
              >
                {t("Confirm restart")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <Button
        disabled={disabled}
        onClick={() =>
          void action(async () => {
            const result = await request<{ available: boolean; output: string }>(
              "logs",
              target(current.server),
            );
            if (alive.current) setLogs(result);
          })
        }
      >
        {t("Show logs")}
      </Button>
      {logs ? (
        logs.available ? (
          <pre className="dev-server-logs" aria-label={t("Server logs")}>
            {logs.output || t("No log output yet.")}
          </pre>
        ) : (
          <p className="host-tool-muted">
            {t(
              current.server.managed
                ? "Logs are unavailable for this process."
                : "Logs are unavailable for this external process.",
            )}
          </p>
        )
      ) : null}
    </section>
  );
  const renderSelection = (server: DevServer) => (
    <aside className="dev-server-selection" aria-label={server.name}>
      <div className="dev-server-heading">
        <h4>{server.name}</h4>
        <span className="dev-server-state" data-state={server.state}>
          {t(stateLabels[server.state])}
        </span>
      </div>
      <p className="host-tool-muted">
        {server.process
          ? `PID ${server.process.pid} · ${server.process.name}`
          : t("Process not started")}
        {" · "}
        {server.managed ? t("Managed") : t("External")}
        {" · "}
        {server.association === "uncertain"
          ? t("Project association uncertain")
          : (server.projectName ?? server.projectId ?? t("Current project"))}
      </p>
      {server.endpoints.length > 1 && endpoint ? (
        <div className="host-tool-field">
          <span>{t("Address")}</span>
          <SearchableSelect
            label={t("Address")}
            value={endpointKey(endpoint)}
            searchable={false}
            onChange={setSelectedEndpoint}
            options={server.endpoints.map((item) => ({
              value: endpointKey(item),
              label: item.url,
            }))}
          />
        </div>
      ) : endpoint ? (
        <code className="dev-server-url">{endpoint.url}</code>
      ) : null}
      <div className="dev-server-actions" role="group" aria-label={t("Actions")}>
        <Button
          variant="primary"
          startIcon={<Eye />}
          disabled={disabled || !endpoint}
          onClick={() => endpoint && setPreview(endpoint.url)}
        >
          {t("Open in preview")}
        </Button>
        <Button
          iconOnly
          label={t("Open in this computer's browser")}
          disabled={disabled || !endpoint}
          onClick={() => endpoint && openLocal(server, endpoint)}
        >
          <ExternalLink size={16} aria-hidden />
        </Button>
        <Button
          iconOnly
          label={t("Copy URL")}
          disabled={disabled || !endpoint}
          onClick={() => endpoint && copyUrl(server, endpoint)}
        >
          <Copy size={16} aria-hidden />
        </Button>
        <span className="dev-server-actions-gap" aria-hidden="true" />
        <Button disabled={disabled} onClick={() => void select(server, "details")}>
          {t("Process details")}
        </Button>
        <Button
          startIcon={<Square />}
          disabled={disabled || !canControl(server) || server.state === "stopped"}
          onClick={() => void select(server, "stop")}
        >
          {t("Stop")}
        </Button>
        <Button
          startIcon={<RotateCcw />}
          disabled={disabled || !canControl(server)}
          onClick={() => void select(server, "restart")}
        >
          {t("Restart")}
        </Button>
        <Button
          variant="ghost"
          iconOnly
          label={t("Actions")}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(event) => {
            const button = event.currentTarget;
            setMenu((current) => (current ? null : button));
          }}
        >
          <MoreHorizontal size={16} aria-hidden />
        </Button>
      </div>
      {menu ? (
        <ExplorerMenu
          anchor={menu}
          ariaLabel={t("Actions")}
          align="end"
          width={248}
          items={[
            {
              kind: "item",
              id: "host",
              label: t("Open in external browser on host"),
              icon: <AppWindow className="size-3.5" />,
              disabled: disabled || !endpoint,
            },
            {
              kind: "item",
              id: "share",
              label: t("Share server"),
              icon: <Share className="size-3.5" />,
              disabled: disabled || server.state !== "running" || !endpoint,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "kill",
              label: t("Force terminate"),
              icon: <CircleX className="size-3.5" />,
              danger: true,
              disabled: disabled || !hasIdentity(server),
            },
          ]}
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {!canControl(server) ? (
        <p className="host-tool-muted">
          {t("Process identity unavailable; process control is disabled.")}
        </p>
      ) : null}
      {(server.command ?? server.process?.command) ? (
        <code className="dev-server-command">{server.command ?? server.process?.command}</code>
      ) : null}
      {(server.cwd ?? server.process?.cwd) ? (
        <p className="host-tool-location">{server.cwd ?? server.process?.cwd}</p>
      ) : null}
      {server.error ? (
        <Alert tone="danger" role="alert">
          {server.error}
        </Alert>
      ) : null}
      {selectedDetails ? renderDetails(selectedDetails) : null}
    </aside>
  );
  return (
    <section
      className="host-tool-panel host-tool-panel-wide dev-servers-panel"
      aria-label={t("Development servers")}
      aria-busy={disabled || (!scan && scanning)}
    >
      <header className="dev-servers-header">
        <div className="dev-servers-title">
          <h3>{t("Development servers")}</h3>
          <span className="host-tool-muted">
            {scanning && !scan
              ? t("Scanning servers…")
              : scanError
                ? t("Scan failed")
                : t("{p0} servers", { p0: visibleServers.length })}
            {autoRefresh ? null : ` · ${t("Paused")}`}
          </span>
          <span className="host-tool-location dev-servers-location" title={cwd}>
            {cwd}
          </span>
        </div>
        <label className="dev-server-search">
          <span className="sr-only">{t("Find server")}</span>
          <SearchInput
            standalone
            type="search"
            placeholder={t("Port, server name or URL")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="dev-server-actions">
          {scanError ? (
            <Button
              startIcon={<RefreshCw />}
              disabled={disabled || scanning}
              onClick={() =>
                void action(async () => {
                  if (await refresh(true)) setAutoRefresh(true);
                })
              }
            >
              {t("Retry scan")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh")}
              disabled={disabled || scanning}
              onClick={() =>
                void action(async () => {
                  if (await refresh(true)) setAutoRefresh(true);
                })
              }
            >
              <RefreshCw />
            </Button>
          )}
          <Button
            variant="ghost"
            iconOnly
            label={autoRefresh ? t("Pause automatic refresh") : t("Resume automatic refresh")}
            onClick={() => setAutoRefresh((value) => !value)}
          >
            {autoRefresh ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("External tunnels")}
            disabled={disabled}
            onClick={() => setSharing("3000")}
          >
            <Share size={16} aria-hidden />
          </Button>
          <Button
            variant="primary"
            startIcon={<Plus />}
            disabled={disabled}
            aria-expanded={showStart}
            onClick={() => setShowStart((value) => !value)}
          >
            {t("Start server")}
          </Button>
        </div>
      </header>
      {scanError ? (
        <Alert tone="danger" role="alert">
          <strong>{t("Could not refresh servers.")}</strong>
          <p className="host-tool-muted">
            {scan
              ? t("Showing the last successful scan. Retry to update.")
              : t("Check the host connection and retry the scan.")}
          </p>
          {failures.current >= MAX_FAILURES && !autoRefresh ? (
            <p className="host-tool-muted">
              {t("Automatic refresh paused after repeated failures.")}
            </p>
          ) : null}
          <details>
            <summary>{t("Error details")}</summary>
            <p>{scanError}</p>
          </details>
        </Alert>
      ) : null}
      {error ? (
        <Alert
          tone="danger"
          role="alert"
          ref={actionError}
          tabIndex={-1}
          className="host-tool-error-payload"
        >
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="info" role="status">
          {notice}
        </Alert>
      ) : null}
      {launch?.pending ? (
        <Alert tone="info" role="status">
          {t("Starting")}
        </Alert>
      ) : null}
      {showStart ? (
        <form
          ref={startForm}
          tabIndex={-1}
          className="dev-server-form"
          onSubmit={(event) => {
            event.preventDefault();
            const expectedPort = port ? Number(port) : undefined;
            if (
              !name.trim() ||
              !command.trim() ||
              (expectedPort !== undefined &&
                (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535))
            )
              return;
            void action(async () => {
              setNotice(t("Starting"));
              const result = await request<DevServerStartResult>("start", {
                name: name.trim(),
                command: command.trim(),
                ...(workingDirectory.trim() ? { cwd: workingDirectory.trim() } : {}),
                expectedPort,
              });
              if (!alive.current) return;
              setStartResult(result);
              await refresh(true);
            });
          }}
        >
          <label className="host-tool-field">
            {t("Server name")}
            <TextField
              hideLabel
              label={t("Server name")}
              value={name}
              required
              maxLength={80}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Server command")}
            <TextField
              hideLabel
              label={t("Server command")}
              value={command}
              required
              maxLength={32768}
              disabled={disabled}
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Working directory")}
            <TextField
              hideLabel
              label={t("Working directory")}
              value={workingDirectory}
              disabled={disabled}
              onChange={(event) => setWorkingDirectory(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Expected port (optional)")}
            <NumberField
              hideLabel
              label={t("Expected port (optional)")}

              min={1}
              max={65535}
              value={port}
              disabled={disabled}
              onChange={(event) => setPort(event.target.value)}
            />
          </label>
          <p className="host-tool-muted">
            {t(
              "To use another port, enter the server command for that port and update the expected port. No flags are added automatically.",
            )}
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={disabled || !name.trim() || !command.trim()}
          >
            {t("Start command")}
          </Button>
        </form>
      ) : null}
      {startResult?.conflict ? (
        <section className="dev-server-conflict" aria-label={t("Port conflict")}>
          <Alert tone="danger" role="alert">
            {t("Port {p0} is already in use.", { p0: startResult.conflict.port })}
          </Alert>
          <p className="host-tool-muted">
            {t("Inspect and stop the existing process, or define a command using another port.")}
          </p>
          <ul className="dev-server-list">{startResult.conflict.servers.map(renderServer)}</ul>
          <Button disabled={disabled} onClick={() => setShowStart(true)}>
            {t("Use another port")}
          </Button>
        </section>
      ) : null}
      {scan && scan.servers.length === 0 && !scanError ? (
        <EmptyState description={t("No servers found")} />
      ) : scan && visibleServers.length === 0 && query ? (
        <EmptyState description={t("No servers match your search.")} />
      ) : null}
      {visibleServers.length || selected ? (
        <div className="dev-server-workspace">
          <ul className="dev-server-list" aria-label={t("Development servers")}>
            {visibleServers.map(renderServer)}
          </ul>
          {selected ? renderSelection(selected) : null}
        </div>
      ) : null}
      {preview ? (
        <section ref={previewPanel} tabIndex={-1} className="dev-server-preview">
          <Button startIcon={<X />} onClick={() => setPreview(undefined)}>
            {t("Close preview")}
          </Button>
          <BrowserPanel cwd={cwd} initialUrl={preview} />
        </section>
      ) : null}
      {sharing ? (
        <ProjectTunnelDialog
          key={`${cwd}:${sharing}`}
          cwd={cwd}
          localUrl={sharing}
          onClose={() => setSharing(undefined)}
        />
      ) : null}
    </section>
  );
}
