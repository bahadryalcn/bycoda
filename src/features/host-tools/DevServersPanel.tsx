import { Code } from "../../shared/ui/Code";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Surface } from "../../shared/ui/Surface";
import { Heading } from "../../shared/ui/Heading";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { OverflowTooltip } from "../../shared/ui/Tooltip";
import { Badge } from "../../shared/ui/Badge";
import { BadgeList } from "../../shared/ui/BadgeList";
import { Alert } from "../../shared/ui/Alert";
import { NumberField } from "../../shared/ui/NumberField";
import { TextField } from "../../shared/ui/TextField";
import { Text } from "../../shared/ui/Text";
import { Checkbox } from "../../shared/ui/Checkbox";
import { SearchInput } from "../../shared/ui/SearchInput";
import { useRetainedState } from "../../shared/hooks/useRetainedState";
import { useCopyFeedback } from "../../shared/hooks/useCopyFeedback";
import { pathKey } from "../../shared/lib/paths";
import { useEffect, useRef, useState } from "react";
import {
  peekToolsDraftPart,
  subscribeToolsDraftTransfer,
  writeToolsDraftPart,
  holdToolsDraftTransfer,
  type ToolsDraftScope,
} from "./toolsDraftTransfer";
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
import { DescriptionItem, DescriptionList } from "../../shared/ui/DescriptionList";
import "./dev-servers.css";

type Intent = "details" | "stop" | "kill" | "restart";
type Launch = { input: DevServerStart; result?: DevServerStartResult; pending?: boolean };
const POLL_MS = 15_000;
const MAX_FAILURES = 3;
/** Each scan starts PowerShell on Windows, so a list that stopped changing is read less often. */
const QUIET_SCANS = 3;
const QUIET_POLL_MS = 30_000;
const VERY_QUIET_POLL_MS = 60_000;
const stateLabels = {
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
};
const stateTones = {
  starting: "info",
  running: "success",
  stopping: "warning",
  stopped: "neutral",
  error: "danger",
} as const;
function StateBadge({ state }: { state: keyof typeof stateLabels }) {
  return (
    <Badge variant="dot" size="sm" tone={stateTones[state]}>
      {t(stateLabels[state])}
    </Badge>
  );
}
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
function pollDelay(failures: number, quietScans: number): number {
  const base =
    quietScans >= QUIET_SCANS * 2
      ? VERY_QUIET_POLL_MS
      : quietScans >= QUIET_SCANS
        ? QUIET_POLL_MS
        : POLL_MS;
  return base * Math.min(4, 2 ** failures);
}

export function DevServersPanel({
  cwd,
  launch,
  active = true,
  transferScope,
}: {
  cwd: string;
  launch?: Launch;
  active?: boolean;
  transferScope?: ToolsDraftScope;
}) {
  return (
    <ProjectDevServersPanel
      key={cwd}
      cwd={cwd}
      launch={launch}
      active={active}
      transferScope={transferScope}
    />
  );
}

function ProjectDevServersPanel({
  cwd,
  launch,
  active,
  transferScope,
}: {
  cwd: string;
  launch?: Launch;
  active: boolean;
  transferScope?: ToolsDraftScope;
}) {
  useLocale();
  const { copyAsync } = useCopyFeedback({ resetKeys: [cwd] });
  const saved = transferScope ? peekToolsDraftPart(transferScope, "servers") : undefined;
  const [scan, setScan] = useState<DevServerScan>();
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<string>();
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useRetainedState(`dev-servers:${pathKey(cwd)}:search`, "");
  const [error, setError] = useState(saved?.error ?? "");
  const [notice, setNotice] = useState(saved?.notice ?? "");
  const [selectedId, setSelectedId] = useState<string | undefined>(saved?.selectedId);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | undefined>(
    saved?.selectedEndpoint,
  );
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [details, setDetails] = useState<DevServerDetails>();
  const [intent, setIntent] = useState<Intent>("details");
  const [tree, setTree] = useState(false);
  const [requiresForce, setRequiresForce] = useState(false);
  const [logs, setLogs] = useState<{ available: boolean; output: string }>();
  const [preview, setPreview] = useState<string>();
  const [sharing, setSharing] = useState<string>();
  const [showStart, setShowStart] = useState(saved?.showStart ?? !!launch);
  const [name, setName] = useState(saved?.name ?? launch?.input.name ?? "");
  const [command, setCommand] = useState(saved?.command ?? launch?.input.command ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(
    saved?.workingDirectory ?? launch?.input.cwd ?? "",
  );
  const [port, setPort] = useState(saved?.port ?? launch?.input.expectedPort?.toString() ?? "");
  const [restartCommand, setRestartCommand] = useState(saved?.restartCommand ?? "");
  const [restartCwd, setRestartCwd] = useState(saved?.restartCwd ?? "");
  const [localStart, setLocalStart] = useState<
    | {
        base: DevServerStartResult | undefined;
        result: DevServerStartResult | undefined;
      }
    | undefined
  >(() => (saved?.startResult ? { base: launch?.result, result: saved.startResult } : undefined));
  useEffect(() => {
    if (!transferScope) return;
    return subscribeToolsDraftTransfer(transferScope, ({ servers }) => {
      if (!servers) return;
      setShowStart(servers.showStart);
      setName(servers.name);
      setCommand(servers.command);
      setWorkingDirectory(servers.workingDirectory);
      setPort(servers.port);
      setRestartCommand(servers.restartCommand);
      setRestartCwd(servers.restartCwd);
      setSelectedId(servers.selectedId);
      setSelectedEndpoint(servers.selectedEndpoint);
      setError(servers.error ?? "");
      setNotice(servers.notice ?? "");
      if (servers.startResult) setLocalStart({ base: launch?.result, result: servers.startResult });
    });
  }, [transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue]);
  useEffect(() => {
    if (active && transferScope)
      writeToolsDraftPart(transferScope, "servers", {
        showStart,
        name,
        command,
        workingDirectory,
        port,
        restartCommand,
        restartCwd,
        selectedId,
        selectedEndpoint,
        error,
        notice,
        startResult: localStart?.result ?? launch?.result,
      });
  }, [
    active,
    transferScope?.cwd,
    transferScope?.sessionId,
    transferScope?.targetValue,
    showStart,
    name,
    command,
    workingDirectory,
    port,
    restartCommand,
    restartCwd,
    selectedId,
    selectedEndpoint,
    error,
    notice,
    localStart?.result,
    launch?.result,
  ]);
  // A start result from this panel replaces the launch's result until the next launch result.
  const setStartResult = (result: DevServerStartResult | undefined) =>
    setLocalStart({ base: launch?.result, result });
  const startResult =
    localStart && localStart.base === launch?.result ? localStart.result : launch?.result;
  const alive = useRef(false);
  const visible = useRef(active);
  visible.current = active;
  const pending = useRef(false);
  const scanFlight = useRef<Promise<boolean> | undefined>(undefined);
  const failures = useRef(0);
  const quiet = useRef({ key: "", scans: 0 });
  const detailsPanel = useRef<HTMLElement>(null);
  const previewPanel = useRef<HTMLElement>(null);
  const startForm = useRef<HTMLFormElement>(null);
  const actionError = useRef<HTMLDivElement>(null);

  const reveal = (element: HTMLElement | null) => {
    if (!visible.current) return;
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
        const key = JSON.stringify(result.servers);
        quiet.current =
          quiet.current.key === key ? { key, scans: quiet.current.scans + 1 } : { key, scans: 0 };
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
  const action = async (name: string, work: () => Promise<unknown>, waitForScan = true) => {
    if (!alive.current || pending.current || launch?.pending) return;
    pending.current = true;
    const releaseTransfer = transferScope ? holdToolsDraftTransfer(transferScope) : undefined;
    setBusy(true);
    setOperation(name);
    setError("");
    setNotice("");
    try {
      // A mutation waits for discovery, but background discovery never disables
      // local preview/copy controls or removes the list under the user's scroll.
      if (waitForScan) await scanFlight.current;
      if (!alive.current) return;
      await work();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      releaseTransfer?.();
      pending.current = false;
      if (alive.current) {
        setBusy(false);
        setOperation(undefined);
      }
    }
  };
  useEffect(() => {
    if (!launch?.pending || !transferScope) return;
    return holdToolsDraftTransfer(transferScope);
  }, [launch?.pending, transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!autoRefresh || !active) return;
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
        timer = setTimeout(() => void poll(), pollDelay(failures.current, quiet.current.scans));
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
  }, [autoRefresh, active]);
  useEffect(() => {
    // A finished launch started a server outside this panel's own requests; rescan for it.
    if (launch?.result?.server) void action("refresh", () => refresh(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.result]);

  const select = (server: DevServer, nextIntent: Intent) => {
    // Pin the server so a reordered rescan cannot move the pane away from a confirmation.
    setSelectedId(server.id);
    return action(`${server.id}:select:${nextIntent}`, async () => {
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
    action(`${details?.server.id}:${operation}`, async () => {
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
  const unavailable = (name: string) => !!launch?.pending || (busy && operation !== name);
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
    void action(`${server.id}:open`, async () => {
      await openUrl(
        await accessibleDevelopmentUrl(cwd, address.url, { server, endpoint: address }),
      );
    });
  const copyUrl = (server: DevServer, address: DevServerEndpoint) =>
    void action(
      `${server.id}:copy`,
      async () => {
        const url = await accessibleDevelopmentUrl(cwd, address.url, { server, endpoint: address });
        if (!alive.current) return;
        const copied = await copyAsync(() =>
          navigator.clipboard.writeText(url).catch((cause) => {
            if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
            throw cause;
          }),
        );
        if (copied && alive.current) setNotice(t("URL copied."));
      },
      false,
    );
  const pickMenu = (id: string) => {
    setMenu(null);
    if (!selected) return;
    if (id === "host" && endpoint)
      void action(`${selected.id}:openHost`, async () => {
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
    <li
      className="dev-server-row"
      key={server.id}
      aria-label={server.name}
      aria-busy={operation?.startsWith(`${server.id}:`) || undefined}
    >
      <Button
        variant="item"
        className="dev-server-row-button"
        aria-pressed={server.id === selected?.id}
        onClick={() => choose(server)}
      >
        <StateBadge state={server.state} />
        <Text
          size="inherit"
          tone="inherit"
          weight="medium"
          leading="inherit"
          as="strong"
          className="dev-server-name"
        >
          {server.name}
        </Text>
        <Code className="dev-server-ports">
          {[...new Set(server.endpoints.map((item) => `:${item.port}`))].join(" ") ||
            t("No listening ports")}
        </Code>
        <Text
          size="micro"
          tone="inherit"
          leading="inherit"
          className="host-tool-muted dev-server-meta"
        >
          {server.process ? `PID ${server.process.pid}` : t("Process not started")}
          {" · "}
          {server.managed ? t("Managed") : t("External")}
        </Text>
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
        <SectionLabel as="h4" className="dev-server-heading-label">
          {t("Process details")}
        </SectionLabel>
        <Button
          variant="ghost"
          iconOnly
          label={t("Close details")}
          disabled={disabled}
          onClick={() => setDetails(undefined)}
        >
          <X className="icon-sm" aria-hidden />
        </Button>
      </div>
      <DescriptionList size="sm">
        <DescriptionItem term={t("Process")}>
          {current.server.process
            ? `${current.server.process.name} · PID ${current.server.process.pid}`
            : t("Process not started")}
        </DescriptionItem>
        <DescriptionItem term={t("Process identity")}>
          {hasIdentity(current.server)
            ? current.server.process!.startedAt
            : t("Process identity unavailable; process control is disabled.")}
        </DescriptionItem>
        <DescriptionItem term={t("Command")}>
          {current.server.command ?? current.server.process?.command ?? t("Unavailable")}
        </DescriptionItem>
        <DescriptionItem term={t("Working directory")}>
          {current.server.cwd ?? current.server.process?.cwd ?? t("Unavailable")}
        </DescriptionItem>
        <DescriptionItem term={t("Affected ports")}>
          {(tree ? current.affectedPorts : current.server.endpoints.map((item) => item.port)).join(
            ", ",
          ) || t("No listening ports")}
        </DescriptionItem>
      </DescriptionList>
      {current.descendants.length ? (
        <>
          <div className="host-tool-muted flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{t("Child processes")}:</span>
            <BadgeList
              label={t("Child processes")}
              size="xs"
              max={4}
              className="min-w-0"
              items={current.descendants.map((process) => ({
                id: `${process.pid}`,
                label: process.name,
                title: `${process.name} (PID ${process.pid})`,
              }))}
            />
          </div>
          <Checkbox
            disabled={disabled || intent === "restart"}
            checked={tree}
            onChange={(event) => setTree(event.target.checked)}
            label={t("Include this process's children")}
            className="host-tool-check"
          />
        </>
      ) : null}
      {intent === "restart" && !current.server.managed ? (
        <Surface variant="outline" className="dev-server-form">
          <p className="host-tool-muted">
            {t("Define the exact command and working directory to restart this external server.")}
          </p>
          <TextField
            label={t("Restart command")}
            value={restartCommand}
            disabled={disabled}
            onChange={(event) => setRestartCommand(event.target.value)}
          />
          <TextField
            label={t("Restart working directory")}
            value={restartCwd}
            disabled={disabled}
            onChange={(event) => setRestartCwd(event.target.value)}
          />
        </Surface>
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
                loading={operation === `${current.server.id}:stop`}
                disabled={unavailable(`${current.server.id}:stop`) || !canControl(current.server)}
                onClick={() => void control("stop")}
              >
                {t("Confirm graceful stop")}
              </Button>
            ) : null}
            {intent === "kill" || requiresForce ? (
              <Button
                variant="danger"
                loading={operation === `${current.server.id}:kill`}
                disabled={unavailable(`${current.server.id}:kill`) || !hasIdentity(current.server)}
                onClick={() => void control("kill")}
              >
                {t("Confirm force terminate")}
              </Button>
            ) : null}
            {intent === "restart" ? (
              <Button
                variant="primary"
                loading={operation === `${current.server.id}:restart`}
                disabled={
                  unavailable(`${current.server.id}:restart`) ||
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
        disabled={unavailable(`${current.server.id}:logs`)}
        loading={operation === `${current.server.id}:logs`}
        onClick={() =>
          void action(`${current.server.id}:logs`, async () => {
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
        <Heading size="item" level={4}>
          {server.name}
        </Heading>
        <StateBadge state={server.state} />
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
        <Text size="caption" tone="inherit" leading="inherit" as="div" className="host-tool-field">
          <span>{t("Address")}</span>
          <SearchableSelect
            hideLabel
            label={t("Address")}
            value={endpointKey(endpoint)}
            searchable={false}
            onChange={setSelectedEndpoint}
            options={server.endpoints.map((item) => ({
              value: endpointKey(item),
              label: item.url,
            }))}
          />
        </Text>
      ) : endpoint ? (
        <Code className="dev-server-url">{endpoint.url}</Code>
      ) : null}
      <div className="dev-server-actions" role="group" aria-label={t("Actions")}>
        <Button
          variant="primary"
          startIcon={<Eye />}
          disabled={!endpoint}
          onClick={() => endpoint && setPreview(endpoint.url)}
        >
          {t("Open in preview")}
        </Button>
        <Button
          iconOnly
          label={t("Open in this computer's browser")}
          loading={operation === `${server.id}:open`}
          disabled={unavailable(`${server.id}:open`) || !endpoint}
          onClick={() => endpoint && openLocal(server, endpoint)}
        >
          <ExternalLink className="icon-sm" aria-hidden />
        </Button>
        <Button
          iconOnly
          label={t("Copy URL")}
          loading={operation === `${server.id}:copy`}
          disabled={unavailable(`${server.id}:copy`) || !endpoint}
          onClick={() => endpoint && copyUrl(server, endpoint)}
        >
          <Copy className="icon-sm" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          iconOnly
          label={t("Actions")}
          loading={
            operation === `${server.id}:openHost` || operation === `${server.id}:select:kill`
          }
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(event) => {
            const button = event.currentTarget;
            setMenu((current) => (current ? null : button));
          }}
        >
          <MoreHorizontal className="icon-sm" aria-hidden />
        </Button>
      </div>
      <div className="dev-server-actions dev-server-process" role="group" aria-label={t("Process")}>
        <Button
          disabled={unavailable(`${server.id}:select:details`)}
          loading={operation === `${server.id}:select:details`}
          onClick={() => void select(server, "details")}
        >
          {t("Process details")}
        </Button>
        <Button
          startIcon={<Square />}
          loading={operation === `${server.id}:select:stop`}
          disabled={
            unavailable(`${server.id}:select:stop`) ||
            !canControl(server) ||
            server.state === "stopped"
          }
          onClick={() => void select(server, "stop")}
        >
          {t("Stop")}
        </Button>
        <Button
          startIcon={<RotateCcw />}
          loading={operation === `${server.id}:select:restart`}
          disabled={unavailable(`${server.id}:select:restart`) || !canControl(server)}
          onClick={() => void select(server, "restart")}
        >
          {t("Restart")}
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
              icon: <AppWindow className="icon-sm" />,
              disabled: disabled || !endpoint,
            },
            {
              kind: "item",
              id: "share",
              label: t("Share server"),
              icon: <Share className="icon-sm" />,
              disabled: disabled || server.state !== "running" || !endpoint,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "kill",
              label: t("Force terminate"),
              icon: <CircleX className="icon-sm" />,
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
      {(server.command ?? server.process?.command ?? server.cwd ?? server.process?.cwd) ? (
        <div className="dev-server-context">
          {(server.command ?? server.process?.command) ? (
            <Code className="dev-server-command">{server.command ?? server.process?.command}</Code>
          ) : null}
          {(server.cwd ?? server.process?.cwd) ? (
            <Text
              size="caption"
              tone="inherit"
              leading="inherit"
              as="p"
              className="host-tool-location"
            >
              {server.cwd ?? server.process?.cwd}
            </Text>
          ) : null}
        </div>
      ) : null}
      {server.error ? <Alert tone="danger">{server.error}</Alert> : null}
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
        <Heading size="item" className="sr-only">
          {t("Development servers")}
        </Heading>
        <div className="dev-server-search">
          <SearchInput
            standalone
            type="search"
            aria-label={t("Find server")}
            placeholder={t("Port, server name or URL")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="dev-server-actions">
          {scanError ? (
            <Button
              startIcon={<RefreshCw />}
              loading={operation === "refresh"}
              disabled={unavailable("refresh") || (scanning && operation !== "refresh")}
              onClick={() =>
                void action("refresh", async () => {
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
              loading={operation === "refresh"}
              disabled={unavailable("refresh") || (scanning && operation !== "refresh")}
              onClick={() =>
                void action("refresh", async () => {
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
            {autoRefresh ? (
              <Pause className="icon-sm" aria-hidden />
            ) : (
              <Play className="icon-sm" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("External tunnels")}
            disabled={disabled}
            onClick={() => setSharing("3000")}
          >
            <Share className="icon-sm" aria-hidden />
          </Button>
          <Button
            variant="primary"
            iconOnly
            label={t("Start server")}
            disabled={disabled}
            aria-expanded={showStart}
            onClick={() => setShowStart((value) => !value)}
          >
            <Plus className="icon-sm" aria-hidden />
          </Button>
        </div>
      </header>
      <Text
        size="caption"
        tone="secondary"
        leading="inherit"
        as="div"
        className="dev-servers-status"
        role="status"
        data-paused={autoRefresh ? undefined : ""}
      >
        <span className="dev-servers-count">
          {scanning && !scan
            ? t("Scanning servers…")
            : scanError
              ? t("Scan failed")
              : t("{p0} servers", { p0: visibleServers.length })}
        </span>
        {autoRefresh ? null : (
          <Text size="inherit" tone="primary" weight="medium" className="dev-servers-paused">
            <Pause className="icon-sm" aria-hidden />
            {t("Paused")}
          </Text>
        )}
        <OverflowTooltip label={cwd}>
          <Text
            size="caption"
            tone="inherit"
            leading="inherit"
            className="host-tool-location dev-servers-location"
          >
            {cwd}
          </Text>
        </OverflowTooltip>
      </Text>
      {scanError ? (
        <Alert tone="danger">
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
          <p className="host-tool-muted">{scanError}</p>
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" ref={actionError} tabIndex={-1} className="host-tool-error-payload">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {showStart ? (
        <Surface as="section" variant="outline">
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
              void action("start", async () => {
                setStartResult(undefined);
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
            <TextField
              label={t("Server name")}
              value={name}
              required
              maxLength={80}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label={t("Server command")}
              value={command}
              required
              maxLength={32768}
              disabled={disabled}
              onChange={(event) => setCommand(event.target.value)}
            />
            <TextField
              label={t("Working directory")}
              value={workingDirectory}
              disabled={disabled}
              onChange={(event) => setWorkingDirectory(event.target.value)}
            />
            <NumberField
              label={t("Expected port (optional)")}

              min={1}
              max={65535}
              value={port}
              disabled={disabled}
              onChange={(event) => setPort(event.target.value)}
            />
            <p className="host-tool-muted">
              {t(
                "To use another port, enter the server command for that port and update the expected port. No flags are added automatically.",
              )}
            </p>
            <Button
              type="submit"
              variant="primary"
              loading={operation === "start" || !!launch?.pending}
              disabled={unavailable("start") || !name.trim() || !command.trim()}
            >
              {t("Start command")}
            </Button>
          </form>
        </Surface>
      ) : null}
      {startResult?.conflict ? (
        <Surface
          as="section"
          variant="outline"
          className="dev-server-conflict"
          aria-label={t("Port conflict")}
        >
          <Alert tone="danger">
            {t("Port {p0} is already in use.", { p0: startResult.conflict.port })}
          </Alert>
          <p className="host-tool-muted">
            {t("Inspect and stop the existing process, or define a command using another port.")}
          </p>
          <ul className="dev-server-list">{startResult.conflict.servers.map(renderServer)}</ul>
          <Button disabled={disabled} onClick={() => setShowStart(true)}>
            {t("Use another port")}
          </Button>
        </Surface>
      ) : null}
      {scan && scan.servers.length === 0 && !scanError ? (
        <EmptyState
          kind="empty"
          description={t("No servers found")}
          action={
            <Button variant="primary" disabled={disabled} onClick={() => setShowStart(true)}>
              {t("Start server")}
            </Button>
          }
        />
      ) : scan && visibleServers.length === 0 && query ? (
        <EmptyState
          kind="filtered"
          description={t("No servers match your search.")}
          onReset={() => setSearch("")}
          resetLabel={t("Clear search")}
        />
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
