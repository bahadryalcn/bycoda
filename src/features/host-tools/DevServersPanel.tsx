import { SearchInput } from "../../shared/ui/SearchInput";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../shared/i18n/technical";
import { hostFeatureRequest } from "../connections/model/hostFeatureClient";
import { BrowserPanel } from "./BrowserPanel";
import { accessibleDevelopmentUrl } from "../connections/model/workspaceUrls";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ProjectTunnelDialog } from "../connections/ui/ProjectTunnelDialog";
import type {
  DevServer,
  DevServerDetails,
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
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const actionError = useRef<HTMLParagraphElement>(null);

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

  const select = (server: DevServer, nextIntent: Intent) =>
    action(async () => {
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
          setScan((value) => value && {
            ...value,
            servers: value.servers.map((item) => item.id === server.id ? server : item),
          });
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
  const renderServer = (server: DevServer) => (
    <article className="dev-server-row" key={server.id} aria-label={server.name}>
      <div className="dev-server-heading">
        <strong>{server.name}</strong>
        <span className="host-tool-status" role="status">
          {t(stateLabels[server.state])}
        </span>
        <span className="host-tool-muted">{server.managed ? t("Managed") : t("External")}</span>
      </div>
      <p className="host-tool-muted">
        {server.process
          ? `PID ${server.process.pid} · ${server.process.name}`
          : t("Process not started")}
        {" · "}
        {server.association === "uncertain"
          ? t("Project association uncertain")
          : (server.projectName ?? server.projectId ?? t("Current project"))}
      </p>
      {server.endpoints.map((endpoint) => (
        <div className="dev-server-endpoint" key={`${endpoint.address}:${endpoint.port}`}>
          <code title={`${endpoint.address}:${endpoint.port}`}>{endpoint.url}</code>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void action(async () => {
                await openUrl(
                  await accessibleDevelopmentUrl(cwd, endpoint.url, { server, endpoint }),
                );
              })
            }
          >
            {t("Open in this computer's browser")}
          </button>
          <button type="button" disabled={disabled} onClick={() => setPreview(endpoint.url)}>
            {t("Open in preview")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void action(async () => {
                await request("openExternal", {
                  ...target(server),
                  port: endpoint.port,
                  address: endpoint.address,
                });
              })
            }
          >
            {t("Open in external browser on host")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void accessibleDevelopmentUrl(cwd, endpoint.url, { server, endpoint })
                .then((url) => navigator.clipboard.writeText(url))
                .then(
                  () => {
                    if (alive.current) setNotice(t("URL copied."));
                  },
                  (cause) => {
                    if (alive.current)
                      setError(cause instanceof Error ? cause.message : String(cause));
                  },
                )
            }
          >
            {t("Copy URL")}
          </button>
        </div>
      ))}
      <details className="dev-server-inspect">
        <summary>{t("Process and controls")}</summary>
        <div className="dev-server-inspect-content">
          {(server.command ?? server.process?.command) ? (
            <code className="dev-server-command">{server.command ?? server.process?.command}</code>
          ) : null}
          {(server.cwd ?? server.process?.cwd) ? (
            <p className="host-tool-location">{server.cwd ?? server.process?.cwd}</p>
          ) : null}
          {server.error ? <p role="alert">{server.error}</p> : null}
          <div className="host-tool-toolbar">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void select(server, "details")}
            >
              {t("Process details")}
            </button>
            <button
              type="button"
              disabled={disabled || server.state !== "running" || !server.endpoints.length}
              onClick={() => setSharing(server.endpoints[0].url)}
            >
              {t("Share server")}
            </button>
            <button
              type="button"
              disabled={disabled || !canControl(server) || server.state === "stopped"}
              onClick={() => void select(server, "stop")}
            >
              {t("Stop")}
            </button>
            <button
              type="button"
              disabled={disabled || !hasIdentity(server)}
              onClick={() => void select(server, "kill")}
            >
              {t("Force terminate")}
            </button>
            <button
              type="button"
              disabled={disabled || !canControl(server)}
              onClick={() => void select(server, "restart")}
            >
              {t("Restart")}
            </button>
          </div>
        </div>
      </details>
    </article>
  );
  return (
    <section
      className="host-tool-panel dev-servers-panel"
      aria-label={t("Development servers")}
      aria-busy={disabled || (!scan && scanning)}
    >
      <header className="host-tool-intro">
        <h3>{t("Development servers")}</h3>
        <p>{t("Find a server by port or name, then open its preview or manage it.")}</p>
        <p className="host-tool-location">{cwd}</p>
      </header>
      <div className="dev-server-searchbar">
        <label className="host-tool-field host-tool-grow">
          {t("Find server")}
          <SearchInput
            standalone
            type="search"
            placeholder={t("Port, server name or URL")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={disabled || scanning}
          onClick={() =>
            void action(async () => {
              if (await refresh(true)) setAutoRefresh(true);
            })
          }
        >
          {scanError ? t("Retry scan") : t("Refresh")}
        </button>
        <button
          type="button"
          disabled={disabled}
          className="host-tool-primary"
          aria-expanded={showStart}
          onClick={() => setShowStart((value) => !value)}
        >
          {t("Start server")}
        </button>
      </div>
      <div className="dev-server-scan-status">
        <span className="host-tool-muted">
          {scanning && !scan
            ? t("Scanning servers…")
            : scanError
              ? t("Scan failed")
              : t("{p0} servers", { p0: visibleServers.length })}
        </span>
        <button
          type="button"
          aria-pressed={autoRefresh}
          onClick={() => setAutoRefresh((value) => !value)}
        >
          {autoRefresh ? t("Pause automatic refresh") : t("Resume automatic refresh")}
        </button>
        <details className="dev-server-sharing">
          <summary>{t("Sharing")}</summary>
          <button type="button" disabled={disabled} onClick={() => setSharing("3000")}>
            {t("External tunnels")}
          </button>
        </details>
      </div>
      {scanError ? (
        <div className="dev-server-scan-error" role="alert">
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
        </div>
      ) : null}
      {error ? <p role="alert" ref={actionError} tabIndex={-1}>{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {launch?.pending ? <p role="status">{t("Starting")}</p> : null}
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
            <input
              value={name}
              required
              maxLength={80}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Server command")}
            <input
              value={command}
              required
              maxLength={32768}
              disabled={disabled}
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Working directory")}
            <input
              value={workingDirectory}
              disabled={disabled}
              onChange={(event) => setWorkingDirectory(event.target.value)}
            />
          </label>
          <label className="host-tool-field">
            {t("Expected port (optional)")}
            <input
              type="number"
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
          <button type="submit" disabled={disabled || !name.trim() || !command.trim()}>
            {t("Start command")}
          </button>
        </form>
      ) : null}
      {startResult?.conflict ? (
        <section className="dev-server-conflict" aria-label={t("Port conflict")}>
          <p role="alert">{t("Port {p0} is already in use.", { p0: startResult.conflict.port })}</p>
          <p className="host-tool-muted">
            {t("Inspect and stop the existing process, or define a command using another port.")}
          </p>
          {startResult.conflict.servers.map(renderServer)}
          <button type="button" disabled={disabled} onClick={() => setShowStart(true)}>
            {t("Use another port")}
          </button>
        </section>
      ) : null}
      {scan && scan.servers.length === 0 && !scanError ? (
        <div className="host-tool-empty">{t("No servers found")}</div>
      ) : scan && visibleServers.length === 0 && query ? (
        <div className="host-tool-empty">{t("No servers match your search.")}</div>
      ) : null}
      <div className="dev-server-list">{visibleServers.map(renderServer)}</div>
      {details ? (
        <section ref={detailsPanel} tabIndex={-1} className="dev-server-details" aria-label={t("Selected process details")}>
          <div className="dev-server-heading">
            <h4>{details.server.name}</h4>
            <button type="button" disabled={disabled} onClick={() => setDetails(undefined)}>
              {t("Close details")}
            </button>
          </div>
          <dl className="dev-server-metadata">
            <dt>{t("Process")}</dt>
            <dd>
              {details.server.process
                ? `${details.server.process.name} · PID ${details.server.process.pid}`
                : t("Process not started")}
            </dd>
            <dt>{t("Process identity")}</dt>
            <dd>
              {hasIdentity(details.server)
                ? details.server.process!.startedAt
                : t("Process identity unavailable; process control is disabled.")}
            </dd>
            <dt>{t("Command")}</dt>
            <dd>{details.server.command ?? details.server.process?.command ?? t("Unavailable")}</dd>
            <dt>{t("Working directory")}</dt>
            <dd>{details.server.cwd ?? details.server.process?.cwd ?? t("Unavailable")}</dd>
            <dt>{t("Affected ports")}</dt>
            <dd>
              {(tree
                ? details.affectedPorts
                : details.server.endpoints.map((endpoint) => endpoint.port)
              ).join(", ") || t("No listening ports")}
            </dd>
          </dl>
          {details.descendants.length ? (
            <>
              <p className="host-tool-muted">
                {t("Child processes")}:{" "}
                {details.descendants
                  .map((process) => `${process.name} (PID ${process.pid})`)
                  .join(", ")}
              </p>
              <label className="host-tool-check">
                <input
                  type="checkbox"
                  disabled={disabled || intent === "restart"}
                  checked={tree}
                  onChange={(event) => setTree(event.target.checked)}
                />
                {t("Include this process's children")}
              </label>
            </>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void action(async () => {
                const result = await request<{ available: boolean; output: string }>(
                  "logs",
                  target(details.server),
                );
                if (alive.current) setLogs(result);
              })
            }
          >
            {t("Show logs")}
          </button>
          {logs ? (
            logs.available ? (
              <pre className="dev-server-logs" aria-label={t("Server logs")}>
                {logs.output || t("No log output yet.")}
              </pre>
            ) : (
              <p className="host-tool-muted">
                {t(
                  details.server.managed
                    ? "Logs are unavailable for this process."
                    : "Logs are unavailable for this external process.",
                )}
              </p>
            )
          ) : null}
          {intent === "restart" && !details.server.managed ? (
            <div className="dev-server-form">
              <p className="host-tool-muted">
                {t(
                  "Define the exact command and working directory to restart this external server.",
                )}
              </p>
              <label className="host-tool-field">
                {t("Restart command")}
                <input
                  value={restartCommand}
                  disabled={disabled}
                  onChange={(event) => setRestartCommand(event.target.value)}
                />
              </label>
              <label className="host-tool-field">
                {t("Restart working directory")}
                <input
                  value={restartCwd}
                  disabled={disabled}
                  onChange={(event) => setRestartCwd(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {intent !== "details" ? (
            <div className="host-tool-toolbar">
              <p className="host-tool-muted">
                {t(
                  "Review the affected ports before confirming. The host verifies process identity before sending a signal.",
                )}
              </p>
              {intent === "stop" && !requiresForce ? (
                <button
                  type="button"
                  disabled={disabled || !canControl(details.server)}
                  onClick={() => void control("stop")}
                >
                  {t("Confirm graceful stop")}
                </button>
              ) : null}
              {intent === "kill" || requiresForce ? (
                <button
                  type="button"
                  disabled={disabled || !hasIdentity(details.server)}
                  onClick={() => void control("kill")}
                >
                  {t("Confirm force terminate")}
                </button>
              ) : null}
              {intent === "restart" ? (
                <button
                  type="button"
                  disabled={
                    disabled ||
                    !canControl(details.server) ||
                    (!details.server.managed && (!restartCommand.trim() || !restartCwd.trim()))
                  }
                  onClick={() => void control("restart")}
                >
                  {t("Confirm restart")}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {preview ? (
        <section ref={previewPanel} tabIndex={-1} className="dev-server-preview">
          <button type="button" onClick={() => setPreview(undefined)}>
            {t("Close preview")}
          </button>
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
