import { EmptyState } from "../../shared/ui/EmptyState";
import { Alert } from "../../shared/ui/Alert";
import { Popover } from "../../shared/ui/Popover";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Badge } from "../../shared/ui/Badge";
import { Switch } from "../../shared/ui/Switch";
import { SegmentedControl } from "../../shared/ui/SegmentedControl";
import { Select } from "../../shared/ui/Select";
import { SlidersHorizontal } from "../../shared/ui/icons";
import { Checkbox } from "../../shared/ui/Checkbox";
import { TextField } from "../../shared/ui/TextField";
import { Button } from "../../shared/ui/Button";
import { SearchInput, SearchInputGroup } from "../../shared/ui/SearchInput";
import { useRetainedState } from "../../shared/hooks/useRetainedState";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { SurfaceSelection } from "../sessions/ui/SurfaceSelection";
import { writeTextFile } from "../../platform/tauri/fs";
import { t, useLocale, getLocale } from "../../shared/i18n/technical";
import {
  ArrowDown,
  Bot,
  Globe,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Square,
} from "../../shared/ui/icons";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
import { hostToolTargetKey, type HostToolTarget } from "../connections/model/hostToolTarget";
import type { OpenFileFn } from "../search/model/search";
import { attachLogsToComposerAcrossWindows } from "./logsComposer";
import {
  clearRuntimeLogs,
  createRuntimeLogsBuffer,
  exportRuntimeLogs,
  filterRuntimeLogs,
  groupRuntimeLogs,
  MAX_RENDERED_RUNTIME_LOGS,
  mergeRuntimeLogs,
  runtimeLogDetailsText,
  runtimeLogFileTarget,
  runtimeLogsAgentPrompt,
  type RuntimeLogGroup,
} from "./runtimeLogsModel";
import type { RuntimeLogEntry, RuntimeLogSnapshot } from "./runtimeLogTypes";
import { runtimeLogDisplayLevel, type RuntimeLogDisplayLevel } from "./runtimeLogPresentation";
import "./runtime-logs.css";

type Props = {
  cwd: string;
  sessionId: string;
  composerSessionId?: string;
  composerWindow?: string;
  target?: HostToolTarget;
  hostLabel?: string;
  onOpenFile?: OpenFileFn;
};

const PROJECT_TARGET: HostToolTarget = { kind: "project" };
const POLL_INTERVAL = 1_500;
const LEVEL_LABELS: Record<RuntimeLogDisplayLevel, string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
  http: "HTTP",
  success: "SUCCESS",
};
const LEVEL_FILTERS: Record<string, RuntimeLogDisplayLevel[] | undefined> = {
  all: undefined,
  problems: ["error", "warn"],
  error: ["error"],
  warn: ["warn"],
  info: ["info"],
  debug: ["debug"],
  http: ["http"],
  success: ["success"],
};

/** A different project, conversation or computer owns a fresh cursor and request scope. */
export function RuntimeLogsPanel(props: Props) {
  return (
    <ScopedRuntimeLogsPanel
      key={JSON.stringify([
        props.cwd,
        props.sessionId,
        hostToolTargetKey(props.target ?? PROJECT_TARGET),
      ])}
      {...props}
    />
  );
}

function ScopedRuntimeLogsPanel({
  cwd,
  sessionId,
  composerSessionId,
  composerWindow,
  target = PROJECT_TARGET,
  hostLabel,
  onOpenFile,
}: Props) {
  useLocale();
  const [buffer, setBuffer] = useState(createRuntimeLogsBuffer);
  const bufferRef = useRef(buffer);
  const targetRef = useRef(target);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [started, setStarted] = useState(true);
  const [monitorUrl, setMonitorUrl] = useState("");
  const [monitors, setMonitors] = useState<{ id: string; url: string; sourceId?: string }[]>([]);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const [monitorOperation, setMonitorOperation] = useState<{
    method: "list" | "start" | "stop";
    id?: unknown;
  }>();
  const [monitorsOpen, setMonitorsOpen] = useState(false);
  const monitorTrigger = useRef<HTMLButtonElement>(null);
  const monitorPending = useRef(false);
  const monitorRevision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [inspecting, setInspecting] = useState(false);
  const inspectingRef = useRef(false);
  const stateKey = `runtime-logs:${JSON.stringify([cwd, sessionId, hostToolTargetKey(target)])}`;
  const [search, setSearch] = useRetainedState(`${stateKey}:search`, "");
  const [source, setSource] = useRetainedState<RuntimeLogEntry["source"] | "all">(
    `${stateKey}:source`,
    "all",
  );
  const [sourceIds, setSourceIds] = useRetainedState<string[]>(`${stateKey}:source-ids`, []);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [level, setLevel] = useRetainedState(`${stateKey}:level`, "all");
  const [grouped, setGrouped] = useRetainedState(`${stateKey}:grouped`, true);
  const [follow, setFollow] = useRetainedState(`${stateKey}:follow`, true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const alive = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timeline = useRef<HTMLDivElement>(null);

  const read = useCallback(
    async (showBusy = true): Promise<void> => {
      if (!alive.current || pending.current || document.hidden) return;
      clearTimeout(timer.current);
      pending.current = true;
      const revision = generation.current;
      if (showBusy) setBusy(true);
      try {
        const current = bufferRef.current;
        const snapshot = await hostToolRequest<RuntimeLogSnapshot>(
          cwd,
          "runtime.logs",
          "runtimeLogs.read",
          {
            ...(current.cursor ? { after: current.cursor } : {}),
            ...(current.streamId ? { streamId: current.streamId } : {}),
            limit: 1_000,
          },
          targetRef.current,
        );
        if (!alive.current || revision !== generation.current) return;
        const next = mergeRuntimeLogs(bufferRef.current, snapshot);
        if (next !== bufferRef.current) {
          bufferRef.current = next;
          setBuffer(next);
          const availableIds = new Set(next.entries.map((entry) => entry.id));
          setSelected((previous) =>
            [...previous].some((id) => !availableIds.has(id))
              ? new Set([...previous].filter((id) => availableIds.has(id)))
              : previous,
          );
        }
        setLoaded(true);
        setError("");
        if (next.restarted) setNotice(t("The host restarted. A new log stream is now active."));
      } catch (cause) {
        if (alive.current && revision === generation.current) {
          setError(cause instanceof Error ? cause.message : String(cause));
          pausedRef.current = true;
          setPaused(true);
        }
      } finally {
        pending.current = false;
        if (alive.current) {
          if (showBusy) setBusy(false);
          if (!pausedRef.current && !document.hidden)
            timer.current = setTimeout(() => void read(false), POLL_INTERVAL);
        }
      }
    },
    [cwd, sessionId],
  );

  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    const visibilityChanged = () => {
      clearTimeout(timer.current);
      // Keep the cursor and retained events. Visibility does not change the
      // owner's explicit Start/Pause state or server-side capture.
      if (!document.hidden && !pausedRef.current) void read(false);
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    void read();
    return () => {
      alive.current = false;
      generation.current += 1;
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [read]);

  const filtered = useMemo(
    () =>
      filterRuntimeLogs(buffer.entries, {
        source: source === "all" ? undefined : source,
        sourceIds,
        levels: LEVEL_FILTERS[level],
        search,
      }),
    [buffer.entries, source, sourceIds, level, search],
  );
  const groups = useMemo(() => groupRuntimeLogs(filtered, grouped), [filtered, grouped]);
  const visibleGroups = groups.slice(-MAX_RENDERED_RUNTIME_LOGS);
  const visibleEntries = visibleGroups.flatMap((group) => group.entries);
  const chosen = useMemo(
    () => buffer.entries.filter((entry) => selected.has(entry.id)),
    [buffer.entries, selected],
  );
  const sourceMap = useMemo(
    () => new Map(buffer.sources.map((entry) => [entry.id, entry])),
    [buffer.sources],
  );
  const errorCount = filtered.reduce(
    (count, entry) => count + Number(runtimeLogDisplayLevel(entry) === "error"),
    0,
  );
  const warningCount = filtered.reduce((count, entry) => count + Number(entry.level === "warn"), 0);
  const typeCounts = useMemo(
    () => ({
      browser: buffer.entries.filter((entry) => entry.source === "browser").length,
      server: buffer.entries.filter((entry) => entry.source === "server").length,
    }),
    [buffer.entries],
  );

  useLayoutEffect(() => {
    const area = timeline.current;
    if (!follow || paused || !area) return;
    // Reading/copying selected output must not be pulled away by the next poll.
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      (area.contains(selection.anchorNode) || area.contains(selection.focusNode))
    )
      return;
    area.scrollTop = area.scrollHeight;
  }, [buffer.cursor, filtered.length, source, sourceIds, level, search, grouped, follow, paused]);

  const togglePause = () => {
    setStarted(true);
    const next = !pausedRef.current;
    pausedRef.current = next;
    generation.current += 1;
    setPaused(next);
    clearTimeout(timer.current);
    if (!next) void read();
  };
  const monitorAction = async (
    method: "list" | "start" | "stop",
    params: Record<string, unknown> = {},
  ) => {
    if (monitorPending.current || target.kind !== "project") return;
    monitorPending.current = true;
    monitorRevision.current += 1;
    setMonitorBusy(true);
    setMonitorOperation({ method, id: params.id });
    setActionError("");
    try {
      if (method !== "list")
        await hostFeatureRequest(
          cwd,
          "runtime.logs.monitors",
          `runtimeLogs.monitors.${method}`,
          params,
        );
      const next = await hostFeatureRequest<typeof monitors>(
        cwd,
        "runtime.logs.monitors",
        "runtimeLogs.monitors.list",
      );
      if (!alive.current) return;
      setMonitors(next ?? []);
      if (method === "start") {
        setMonitorUrl("");
        setStarted(true);
        pausedRef.current = false;
        setPaused(false);
        // Capturing a website must not hide the project's server output.
        setSource("all");
        setSourceIds([]);
      }
      await read();
    } catch (cause) {
      if (alive.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      monitorPending.current = false;
      if (alive.current) {
        setMonitorBusy(false);
        setMonitorOperation(undefined);
      }
    }
  };
  useEffect(() => {
    if (target.kind !== "project") return;
    let active = true;
    const revision = monitorRevision.current;
    void hostFeatureRequest<typeof monitors>(
      cwd,
      "runtime.logs.monitors",
      "runtimeLogs.monitors.list",
    )
      .then((items) => {
        if (active && revision === monitorRevision.current) setMonitors(items ?? []);
      })
      .catch((cause) => {
        if (active) setActionError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [cwd, target.kind]);
  const clear = () => {
    const next = clearRuntimeLogs(bufferRef.current);
    bufferRef.current = next;
    setBuffer(next);
    setSelected(new Set());
    setActionError("");
    setNotice(t("View cleared. New events will appear here."));
  };
  const selectGroup = useCallback((group: RuntimeLogGroup, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const entry of group.entries) {
        if (checked) next.add(entry.id);
        else next.delete(entry.id);
      }
      return next;
    });
  }, []);
  const inspect = async () => {
    if (inspectingRef.current) return;
    const problems = visibleEntries.filter(
      (entry) => runtimeLogDisplayLevel(entry) === "error" || entry.level === "warn",
    );
    const entries = chosen.length ? chosen : problems.length ? problems : visibleEntries;
    if (!entries.length) return;
    inspectingRef.current = true;
    setInspecting(true);
    setActionError("");
    setNotice("");
    try {
      await attachLogsToComposerAcrossWindows(
        cwd,
        composerSessionId ?? sessionId,
        runtimeLogsAgentPrompt(entries, buffer.sources, { cwd, hostLabel }),
        composerWindow,
      );
      if (alive.current)
        setNotice(t("Logs added to conversation draft. Review and send when ready."));
    } catch (cause) {
      if (alive.current) setActionError(t(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      inspectingRef.current = false;
      if (alive.current) setInspecting(false);
    }
  };
  const exportLogs = async () => {
    if (exportingRef.current) return;
    const entries = chosen.length ? chosen : filtered;
    if (!entries.length) return;
    exportingRef.current = true;
    setExporting(true);
    setActionError("");
    const revision = generation.current;
    try {
      const content = exportRuntimeLogs(entries, buffer.sources, { cwd, hostLabel });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = await save({
        title: t("Export logs"),
        defaultPath: "bycoda-runtime-logs-" + stamp + ".jsonl",
        filters: [{ name: t("Log files"), extensions: ["jsonl", "txt"] }],
      });
      if (!path || !alive.current) return;
      await writeTextFile(path, content);
      if (alive.current && revision === generation.current) setNotice(t("Logs exported."));
    } catch (cause) {
      if (alive.current && revision === generation.current)
        setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      exportingRef.current = false;
      if (alive.current) setExporting(false);
    }
  };

  const empty =
    !started && !busy
      ? t(
          "Read logs from Browser and Development servers, then add useful events to your conversation.",
        )
      : !loaded && busy
        ? t("Connecting to the log stream…")
        : error && !loaded
          ? t("Logs are unavailable. Check the selected computer's host connection and retry.")
          : paused && !buffer.entries.length
            ? t("The view is paused. Resume or refresh to read new events.")
            : buffer.entries.length && !filtered.length
              ? t("No logs match these filters. Adjust the source, level or search.")
              : t(
                  "Open a page in Browser or start a managed server in Servers to begin capturing.",
                );

  return (
    <section
      className="host-tool-panel host-tool-panel-wide runtime-logs-panel"
      aria-label={t("Runtime logs")}
    >
      <div className="runtime-logs-controls">
        <div className="runtime-logs-source-picker">
          <SearchableSelect
            multiple
            label={t("Log source")}
            value={sourceIds}
            onChange={setSourceIds}
            placeholder={t("All sources")}
            options={buffer.sources
              .filter((entry) => source === "all" || entry.kind === source)
              .map((entry) => ({
                value: entry.id,
                label: `${entry.url ?? entry.label}${entry.available ? "" : " · " + t("Unavailable")}`,
                keywords: [entry.label, entry.url, entry.reason].filter(Boolean).join(" "),
              }))}
            searchPlaceholder={t("Search sources by name or URL")}
          />
        </div>
        <Button
          ref={filterTrigger}
          variant="ghost"
          iconOnly
          label={t("Filters")}
          tooltip={t("Filters")}
          selected={source !== "all" || sourceIds.length > 0 || level !== "all"}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onClick={() => {
            setMonitorsOpen(false);
            setMoreOpen(false);
            setFiltersOpen((value) => !value);
          }}
        >
          <SlidersHorizontal className="icon-md" />
        </Button>
        {filtersOpen ? (
          <Popover
            anchor={filterTrigger}
            role="dialog"
            aria-label={t("Log filters")}
            side="bottom"
            align="start"
            width={360}
            autoFocus
            onDismiss={(reason) => {
              setFiltersOpen(false);
              if (reason === "escape") filterTrigger.current?.focus();
            }}
          >
            <div className="runtime-logs-filter-content">
              <SegmentedControl
                label={t("Log type")}
                value={source}
                onValueChange={(value) => {
                  setSource(value as RuntimeLogEntry["source"] | "all");
                  setSourceIds([]);
                }}
                options={(["all", "browser", "server"] as const).map((kind) => ({
                  value: kind,
                  label:
                    kind === "all" ? t("All") : kind === "browser" ? t("Browser") : t("Server"),
                  accessory: kind === "all" ? buffer.entries.length : typeCounts[kind],
                }))}
              />
              <Select
                label={t("Log level")}
                value={level}
                onValueChange={setLevel}
                options={(
                  ["all", "error", "warn", "debug", "info", "success", "http"] as const
                ).map((value) => ({
                  value,
                  label: value === "all" ? t("All levels") : LEVEL_LABELS[value],
                }))}
              />
              <Switch
                label={t("Group repeated errors")}
                checked={grouped}
                onCheckedChange={setGrouped}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setSource("all");
                  setSourceIds([]);
                  setLevel("all");
                }}
              >
                {t("Reset filters")}
              </Button>
            </div>
          </Popover>
        ) : null}
        <SearchInputGroup appearance="field" className="runtime-logs-search">
          <Search className="icon-md" />
          <SearchInput
            focusOwner="group"
            type="search"
            aria-label={t("Search logs")}
            placeholder={t("Search logs")}
            maxLength={500}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </SearchInputGroup>
        <div className="runtime-logs-stream-actions">
          <Button
            motion="none"
            variant="ghost"
            iconOnly
            label={t("Add to conversation")}
            tooltip={t("Add to conversation")}
            size="sm"
            type="button"
            disabled={!chosen.length && !visibleEntries.length}
            loading={inspecting}
            onClick={inspect}
            title={t("Selected logs or visible errors are added to your draft for review.")}
          >
            <Bot className="icon-md" />
          </Button>
          <Button
            motion="none"
            variant="ghost"
            iconOnly
            label={!started ? t("Read logs") : paused ? t("Resume") : t("Pause")}
            tooltip={!started ? t("Read logs") : paused ? t("Resume") : t("Pause")}
            size="sm"
            type="button"
            onClick={togglePause}
          >
            {paused ? <Play className="icon-sm" /> : <Pause className="icon-sm" />}
          </Button>
          <Button
            motion="none"
            variant="ghost"
            iconOnly
            type="button"
            disabled={busy}
            loading={busy}
            onClick={() => void read()}
            tooltip={t("Refresh")}
            label={t("Refresh")}
          >
            <RefreshCw className="icon-sm" />
          </Button>
          <Button
            motion="none"
            variant="ghost"
            iconOnly
            type="button"
            aria-pressed={follow}
            selected={follow}
            onClick={() => setFollow(!follow)}
            tooltip={t("Follow latest")}
            label={t("Follow latest")}
          >
            <ArrowDown className="icon-sm" />
          </Button>
          {target.kind === "project" && (
            <Button
              ref={monitorTrigger}
              motion="none"
              variant="ghost"
              iconOnly
              label={t("Website monitors")}
              tooltip={t("Website monitors")}
              selected={monitors.length > 0}
              aria-haspopup="dialog"
              aria-expanded={monitorsOpen}
              onClick={() => {
                setFiltersOpen(false);
                setMoreOpen(false);
                setMonitorsOpen((open) => !open);
              }}
            >
              <Globe className="icon-sm" />
            </Button>
          )}
          <Button
            ref={moreTrigger}
            motion="none"
            variant="ghost"
            iconOnly
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            tooltip={t("More actions")}
            label={t("More actions")}
            onClick={() => {
              setMonitorsOpen(false);
              setFiltersOpen(false);
              setMoreOpen((open) => !open);
            }}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {moreOpen ? (
            <DropdownMenu
              anchor={moreTrigger}
              label={t("More actions")}
              items={[
                {
                  kind: "item",
                  id: "export",
                  label: t("Export logs"),
                  disabled: exporting || (!chosen.length && !filtered.length),
                },
                { kind: "sep" },
                { kind: "item", id: "clear", label: t("Clear view"), danger: true },
              ]}
              onClose={() => setMoreOpen(false)}
              returnFocusRef={moreTrigger}
              onPick={(id) => {
                setMoreOpen(false);
                if (id === "export") void exportLogs();
                else clear();
              }}
            />
          ) : null}
        </div>
      </div>

      {target.kind === "project" && monitorsOpen ? (
        <Popover
          anchor={monitorTrigger}
          role="dialog"
          aria-label={t("Website monitors")}
          side="bottom"
          align="end"
          width={380}
          autoFocus
          solid
          onDismiss={() => setMonitorsOpen(false)}
          className="runtime-logs-monitors-popover"
        >
          <section className="runtime-logs-monitor-setup" aria-label={t("Capture website logs")}>
            <form
              className="runtime-logs-capture-form"
              title={t(
                "Opens a separate browser. Capture continues until you stop the website monitor.",
              )}
              onSubmit={(event) => {
                event.preventDefault();
                if (monitorUrl.trim()) void monitorAction("start", { url: monitorUrl.trim() });
              }}
            >
              <Globe className="icon-sm" />
              <TextField
                hideLabel
                label={t("Website port or URL")}
                aria-label={t("Website port or URL")}
                value={monitorUrl}
                onChange={(event) => setMonitorUrl(event.target.value)}
                disabled={monitorBusy}
                placeholder="3000 / http://localhost:5173"
                maxLength={2048}
                required
              />
              <Button
                motion="none"
                variant="ghost"
                size="sm"
                type="submit"
                disabled={monitorBusy || !monitorUrl.trim()}
                loading={monitorOperation?.method === "start"}
                title={t("Open website and capture logs")}
                aria-label={t("Open website and capture logs")}
              >
                <Play className="icon-sm" />
                <span className="runtime-logs-sr">{t("Capture website logs")}</span>
              </Button>
              <Button
                motion="none"
                variant="ghost"
                size="sm"
                type="button"
                disabled={monitorBusy}
                loading={monitorOperation?.method === "list"}
                onClick={() => void monitorAction("list")}
                title={t("Load monitors")}
                aria-label={t("Load monitors")}
              >
                <RefreshCw className="icon-sm" />
              </Button>
            </form>
            {monitors.length ? (
              <ul className="runtime-logs-monitor-chips">
                {monitors.map((monitor) => (
                  <li key={monitor.id}>
                    <Button
                      motion="none"
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="runtime-logs-monitor-name"
                      aria-pressed={!!monitor.sourceId && sourceIds.includes(monitor.sourceId)}
                      title={monitor.url}
                      disabled={!monitor.sourceId}
                      onClick={() => {
                        const id = monitor.sourceId;
                        if (!id) return;
                        setSource("all");
                        setSourceIds((previous) =>
                          previous.includes(id)
                            ? previous.filter((item) => item !== id)
                            : [...previous, id],
                        );
                      }}
                    >
                      {monitor.url}
                    </Button>
                    <Button
                      motion="none"
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={monitorBusy}
                      loading={
                        monitorOperation?.method === "stop" && monitorOperation.id === monitor.id
                      }
                      title={t("Stop monitor")}
                      aria-label={t("Stop monitor")}
                      onClick={() => void monitorAction("stop", { id: monitor.id })}
                    >
                      <Square className="icon-sm" />
                      <span className="runtime-logs-sr">{t("Stop monitor")}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="host-tool-muted">
              {t("Opens a separate browser. Capture continues until you stop the website monitor.")}
            </p>
          </section>
        </Popover>
      ) : null}
      {error ? (
        <Alert tone="danger" role="alert">
          <p>{t("Could not read logs. Check the host connection and retry.")}</p>
          <details>
            <summary>{t("Technical details")}</summary>
            <pre>{error}</pre>
          </details>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="danger" role="alert">
          <p>
            {t(
              actionError.includes("ERR_CONNECTION_REFUSED")
                ? "Website is not running. Start it in Development servers, then try again."
                : "The action failed. Check the details and retry.",
            )}
          </p>
          <details>
            <summary>{t("Technical details")}</summary>
            <pre>{actionError}</pre>
          </details>
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="info" role="status">
          {notice}
        </Alert>
      ) : null}

      <div
        ref={timeline}
        className="runtime-logs-timeline"
        role="region"
        aria-label={t("Log timeline")}
        tabIndex={0}
        onScroll={(event) => {
          const area = event.currentTarget;
          const atEnd = area.scrollHeight - area.scrollTop - area.clientHeight < 32;
          if (atEnd !== follow) setFollow(atEnd);
        }}
      >
        <SurfaceSelection
          className="contents"
          cwd={cwd}
          context={
            source === "all"
              ? "Runtime logs"
              : source === "browser"
                ? "Browser logs"
                : "Server logs"
          }
        >
          {visibleGroups.length ? (
            <ol className="runtime-logs-list">
              {visibleGroups.map((group) => (
                <RuntimeLogRow
                  key={group.id}
                  group={group}
                  sourceLabel={sourceMap.get(group.entry.sourceId)?.label ?? group.entry.sourceId}
                  selectedCount={group.entries.reduce(
                    (count, entry) => count + Number(selected.has(entry.id)),
                    0,
                  )}
                  onSelect={selectGroup}
                  cwd={cwd}
                  onOpenFile={target.kind === "project" ? onOpenFile : undefined}
                />
              ))}
            </ol>
          ) : (
            <EmptyState
              icon={
                <>
                  <Globe className="icon-lg" />
                  <Terminal className="icon-lg" />
                </>
              }
              title={loaded && !buffer.entries.length ? t("Waiting for logs") : t("Runtime logs")}
              description={empty}
            />
          )}
        </SurfaceSelection>
      </div>

      <footer className="runtime-logs-footer">
        <Badge
          variant="dot"
          size="sm"
          tone={error ? "danger" : paused || !started ? "neutral" : loaded ? "success" : "info"}
          role="status"
          title={hostLabel}
        >
          {error
            ? t("Disconnected")
            : !started
              ? t("Stopped")
              : paused
                ? t("Paused")
                : loaded
                  ? t("Live")
                  : t("Connecting…")}
        </Badge>
        <div className="runtime-logs-selection">
          <span>
            {chosen.length
              ? t("{p0} selected logs", { p0: chosen.length })
              : t("{p0} visible events", { p0: visibleEntries.length })}
          </span>
          {chosen.length ? (
            <Button
              motion="none"
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setSelected(new Set())}
            >
              {t("Deselect all")}
            </Button>
          ) : null}
          {groups.length > visibleGroups.length ? (
            <span>{t("Showing the latest {p0} rows.", { p0: MAX_RENDERED_RUNTIME_LOGS })}</span>
          ) : null}
        </div>
        <span className="runtime-logs-totals">
          {errorCount > 0 && <span data-level="error">{t("{p0} errors", { p0: errorCount })}</span>}
          {warningCount > 0 && (
            <span data-level="warn">{t("{p0} warnings", { p0: warningCount })}</span>
          )}
        </span>
      </footer>
      {buffer.dropped || buffer.trimmed ? (
        <p className="runtime-logs-hint">
          {t("{p0} older events were dropped from retained history.", {
            p0: buffer.dropped + buffer.trimmed,
          })}
        </p>
      ) : null}
    </section>
  );
}

const RuntimeLogRow = memo(function RuntimeLogRow({
  group,
  sourceLabel,
  selectedCount,
  onSelect,
  cwd,
  onOpenFile,
}: {
  group: RuntimeLogGroup;
  sourceLabel: string;
  selectedCount: number;
  onSelect: (group: RuntimeLogGroup, checked: boolean) => void;
  cwd: string;
  onOpenFile?: OpenFileFn;
}) {
  const [expanded, setExpanded] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const entry = group.entry;
  const time = new Date(entry.timestamp).toLocaleTimeString(getLocale(), { hour12: false });
  const file = runtimeLogFileTarget(cwd, entry.location);
  return (
    <li
      className="runtime-log-row"
      data-level={runtimeLogDisplayLevel(entry)}
      data-source={entry.source}
      data-selected={selectedCount > 0}
    >
      <label className="runtime-log-select">
        <Checkbox
          ref={checkbox}
          indeterminate={selectedCount > 0 && selectedCount < group.entries.length}

          checked={selectedCount === group.entries.length}
          aria-label={t("Select log at {p0}", { p0: time })}
          onChange={(event) => onSelect(group, event.target.checked)}
        />
      </label>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="runtime-log-summary">
          <div className="runtime-log-meta">
            <span className="runtime-log-kind" data-source={entry.source}>
              {entry.source === "browser" ? "[BROWSER]" : "[SERVER]"}
            </span>
            <time
              dateTime={new Date(entry.timestamp).toISOString()}
              title={new Date(entry.timestamp).toLocaleString(getLocale())}
            >
              {time}
            </time>
            <span className="runtime-log-level">{LEVEL_LABELS[runtimeLogDisplayLevel(entry)]}</span>
            <span className="runtime-log-source-label" title={sourceLabel}>
              {sourceLabel}
            </span>
            {group.entries.length > 1 ? (
              <span
                className="runtime-log-count"
                title={t("{p0} repeated events", { p0: group.entries.length })}
              >
                ×{group.entries.length}
              </span>
            ) : null}
            <span className="runtime-log-details-trigger">{t("Details")}</span>
          </div>
          <p className="runtime-log-message">{entry.message || t("Empty log message")}</p>
        </summary>
        {expanded ? (
          <div className="runtime-log-detail-body">
            <pre className="runtime-log-full-message">{entry.message}</pre>
            {entry.location ? (
              <div className="runtime-log-location">
                {file && onOpenFile ? (
                  <Button
                    motion="none"
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onOpenFile(file.path, file.navigation)}
                  >
                    {file.label}
                    {file.navigation
                      ? ":" +
                        file.navigation.line +
                        (file.navigation.column ? ":" + file.navigation.column : "")
                      : ""}
                  </Button>
                ) : (
                  <code>
                    {entry.location.file}
                    {entry.location.line ? ":" + entry.location.line : ""}
                    {entry.location.column ? ":" + entry.location.column : ""}
                  </code>
                )}
              </div>
            ) : null}
            {entry.details !== undefined ? (
              <div className="runtime-log-object">
                <h4>{t("Objects")}</h4>
                <ObjectInspector value={entry.details} />
              </div>
            ) : null}
            {entry.stack ? (
              <div>
                <h4>{t("Stack trace")}</h4>
                <pre>{entry.stack}</pre>
              </div>
            ) : null}
            {group.entries.length > 1 ? (
              <p className="runtime-logs-hint">
                {t("First seen {p0}; last seen {p1}.", {
                  p0: new Date(group.firstTimestamp).toLocaleTimeString(getLocale()),
                  p1: time,
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </details>
    </li>
  );
});

function ObjectInspector({ value }: { value: unknown }) {
  const budget = { remaining: 160 };
  const seen = new WeakSet<object>();
  const render = (item: unknown, depth: number): ReactNode => {
    if (--budget.remaining < 0) return <code>…</code>;
    if (!item || typeof item !== "object") return <code>{runtimeLogDetailsText(item, 2_000)}</code>;
    if (seen.has(item)) return <code>[Circular]</code>;
    seen.add(item);
    if (depth >= 5) return <pre>{runtimeLogDetailsText(item, 3_000)}</pre>;
    const entries = Object.entries(item);
    return (
      <details open={depth === 0} className="runtime-log-object-node">
        <summary>
          {Array.isArray(item) ? t("Array") : t("Object")} ({entries.length})
        </summary>
        <ul>
          {entries.slice(0, 30).map(([key, child]) => (
            <li key={key}>
              <code className="runtime-log-object-key">{key}:</code>
              {render(child, depth + 1)}
            </li>
          ))}
          {entries.length > 30 ? (
            <li>
              <code>…</code>
            </li>
          ) : null}
        </ul>
      </details>
    );
  };
  return <div className="runtime-log-object-tree">{render(value, 0)}</div>;
}
