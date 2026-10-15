import { SearchInput, SearchInputGroup } from "../../shared/ui/SearchInput";
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
  ArrowDownCircle,
  Bot,
  Globe,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  File,
  Copy,
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
  const monitorPending = useRef(false);
  const monitorRevision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<RuntimeLogEntry["source"] | "all">("all");
  const [sourceId, setSourceId] = useState("");
  const [level, setLevel] = useState("all");
  const [grouped, setGrouped] = useState(true);
  const [follow, setFollow] = useState(true);
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
          { ...(current.cursor ? { after: current.cursor } : {}), limit: 1_000 },
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
        sourceId: sourceId || undefined,
        levels: LEVEL_FILTERS[level],
        search,
      }),
    [buffer.entries, source, sourceId, level, search],
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
    if (follow && !paused && timeline.current)
      timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [buffer.cursor, filtered.length, source, sourceId, level, search, grouped, follow, paused]);

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
        setSourceId("");
      }
      await read();
    } catch (cause) {
      if (alive.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      monitorPending.current = false;
      if (alive.current) setMonitorBusy(false);
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
    const problems = visibleEntries.filter(
      (entry) => runtimeLogDisplayLevel(entry) === "error" || entry.level === "warn",
    );
    const entries = chosen.length ? chosen : problems.length ? problems : visibleEntries;
    if (!entries.length) return;
    setActionError("");
    setNotice("");
    try {
      await attachLogsToComposerAcrossWindows(
        cwd,
        composerSessionId ?? sessionId,
        runtimeLogsAgentPrompt(entries, buffer.sources, { cwd, hostLabel }),
        composerWindow,
      );
      setNotice(t("Logs added to conversation draft. Review and send when ready."));
    } catch (cause) {
      setActionError(t(cause instanceof Error ? cause.message : String(cause)));
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
      <header className="runtime-logs-heading">
        <div className="runtime-logs-title">
          <Terminal size={17} />
          <h3>{t("Runtime logs")}</h3>
          {hostLabel ? (
            <span className="runtime-logs-host" title={hostLabel}>
              {hostLabel}
            </span>
          ) : null}
        </div>
        <span
          className="runtime-logs-state"
          data-state={error ? "offline" : paused ? "paused" : "live"}
          role="status"
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
        </span>
      </header>

      <div className="runtime-logs-controls">
        <SearchInputGroup className="runtime-logs-search">
          <Search size={15} />
          <SearchInput
            focusOwner="group"
            type="search"
            aria-label={t("Search logs")}
            placeholder={t("Search logs, objects and stack traces")}
            maxLength={500}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </SearchInputGroup>
        <div className="runtime-logs-stream-actions">
          <button type="button" className="host-tool-primary" onClick={togglePause}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {!started ? t("Read logs") : paused ? t("Resume") : t("Pause")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void read()}
            title={t("Refresh")}
            aria-label={t("Refresh")}
          >
            <RefreshCw size={14} />
            <span className="runtime-logs-sr">{t("Refresh")}</span>
          </button>
          <button
            type="button"
            onClick={clear}
            title={t("Clear view")}
            aria-label={t("Clear view")}
          >
            <Trash2 size={14} />
            <span className="runtime-logs-sr">{t("Clear view")}</span>
          </button>
          <button
            type="button"
            aria-pressed={follow}
            onClick={() => setFollow(!follow)}
            title={t("Follow latest")}
            aria-label={t("Follow latest")}
          >
            <ArrowDownCircle size={14} />
          </button>
          <button
            type="button"
            aria-pressed={grouped}
            onClick={() => setGrouped(!grouped)}
            title={t("Group repeated errors")}
            aria-label={t("Group repeated errors")}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            disabled={exporting || (!chosen.length && !filtered.length)}
            onClick={() => void exportLogs()}
            title={t("Export logs")}
            aria-label={t("Export logs")}
          >
            <File size={14} />
            <span className="runtime-logs-sr">{t("Export logs")}</span>
          </button>
        </div>
      </div>

      <div className="runtime-logs-filters">
        <div className="runtime-logs-source-switch" role="group" aria-label={t("Log type")}>
          {(["all", "browser", "server"] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              aria-pressed={source === kind}
              data-source={kind}
              onClick={() => {
                setSource(kind);
                setSourceId("");
              }}
            >
              {kind === "browser" ? (
                <Globe size={13} />
              ) : kind === "server" ? (
                <Terminal size={13} />
              ) : null}
              {kind === "all" ? t("All") : kind === "browser" ? t("Browser") : t("Server")}
              <span>{kind === "all" ? buffer.entries.length : typeCounts[kind]}</span>
            </button>
          ))}
        </div>
        <span className="runtime-logs-totals">
          <span data-level="error">{t("{p0} errors", { p0: errorCount })}</span>
          <span data-level="warn">{t("{p0} warnings", { p0: warningCount })}</span>
        </span>
      </div>

      <div className="runtime-logs-inline-filters">
        <div className="host-tool-field runtime-logs-filter">
          <span>{t("Log source")}</span>
          <SearchableSelect
            label={t("Log source")}
            value={sourceId}
            onChange={setSourceId}
            options={[
              { value: "", label: t("All sources") },
              ...buffer.sources
                .filter((entry) => source === "all" || entry.kind === source)
                .map((entry) => ({
                  value: entry.id,
                  label: `${entry.label}${entry.url ? ` · ${entry.url}` : ""}${entry.available ? "" : " · " + t("Unavailable")}`,
                })),
            ]}
            searchPlaceholder={t("Search sources by name or URL")}
          />
        </div>
        <div className="runtime-logs-levels" role="group" aria-label={t("Log level")}>
          {(["all", "error", "warn", "debug", "info", "success", "http"] as const).map((value) => (
            <button
              type="button"
              key={value}
              data-level={value}
              aria-pressed={level === value}
              onClick={() => setLevel(value)}
            >
              {value === "all" ? t("All levels") : LEVEL_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      {target.kind === "project" ? (
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
            <Globe size={14} />
            <input
              aria-label={t("Website port or URL")}
              value={monitorUrl}
              onChange={(event) => setMonitorUrl(event.target.value)}
              disabled={monitorBusy}
              placeholder="3000 / http://localhost:5173"
              maxLength={2048}
              required
            />
            <button
              type="submit"
              disabled={monitorBusy || !monitorUrl.trim()}
              title={t("Open website and capture logs")}
              aria-label={t("Open website and capture logs")}
            >
              <Play size={14} />
              <span className="runtime-logs-sr">{t("Capture website logs")}</span>
            </button>
            <button
              type="button"
              disabled={monitorBusy}
              onClick={() => void monitorAction("list")}
              title={t("Load monitors")}
              aria-label={t("Load monitors")}
            >
              <RefreshCw size={14} />
            </button>
          </form>
        </section>
      ) : null}
      <div className="runtime-logs-source-list" aria-label={t("Log source")}>
        {buffer.sources
          .filter((entry) => source === "all" || entry.kind === source)
          .map((entry) => {
            const monitor = monitors.find((item) => item.sourceId === entry.id);
            return (
              <div className="runtime-logs-source" key={entry.id} data-available={entry.available}>
                {entry.kind === "browser" ? <Globe size={13} /> : <Terminal size={13} />}
                <button
                  type="button"
                  className="runtime-logs-source-name"
                  aria-pressed={sourceId === entry.id}
                  title={[entry.label, entry.url ?? monitor?.url, entry.reason]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => {
                    setSource(entry.kind);
                    setSourceId(sourceId === entry.id ? "" : entry.id);
                  }}
                >
                  <strong>{entry.url ?? monitor?.url ?? entry.label}</strong>
                  <span>{entry.available ? t("Capturing") : t("Unavailable")}</span>
                </button>
                {monitor ? (
                  <button
                    type="button"
                    disabled={monitorBusy}
                    title={t("Stop monitor")}
                    aria-label={t("Stop monitor")}
                    onClick={() => void monitorAction("stop", { id: monitor.id })}
                  >
                    <Square size={13} />
                    <span className="runtime-logs-sr">{t("Stop monitor")}</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        {monitors
          .filter((item) => !buffer.sources.some((entry) => entry.id === item.sourceId))
          .map((monitor) => (
            <div className="runtime-logs-source" key={monitor.id}>
              <Globe size={13} />
              <button
                type="button"
                className="runtime-logs-source-name"
                onClick={() => {
                  setSource("browser");
                  setSourceId(monitor.sourceId ?? "");
                }}
              >
                {monitor.url}
              </button>
              <button
                type="button"
                disabled={monitorBusy}
                aria-label={t("Stop monitor")}
                title={t("Stop monitor")}
                onClick={() => void monitorAction("stop", { id: monitor.id })}
              >
                <Square size={13} />
              </button>
            </div>
          ))}
      </div>
      {error ? (
        <div role="alert" className="runtime-logs-error">
          <p>{t("Could not read logs. Check the host connection and retry.")}</p>
          <details>
            <summary>{t("Technical details")}</summary>
            <pre>{error}</pre>
          </details>
        </div>
      ) : null}
      {actionError ? (
        <div role="alert" className="runtime-logs-error">
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
        </div>
      ) : null}
      {notice ? (
        <p className="runtime-logs-notice" role="status">
          {notice}
        </p>
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
            <div className="runtime-logs-empty">
              <div className="runtime-logs-empty-icons">
                <Globe size={24} />
                <Terminal size={24} />
              </div>
              <strong>
                {loaded && !buffer.entries.length ? t("Waiting for logs") : t("Runtime logs")}
              </strong>
              <p>{empty}</p>
            </div>
          )}
        </SurfaceSelection>
      </div>

      <footer className="runtime-logs-footer">
        <div className="runtime-logs-selection">
          <span>
            {chosen.length
              ? t("{p0} selected logs", { p0: chosen.length })
              : t("{p0} visible events", { p0: visibleEntries.length })}
          </span>
          {chosen.length ? (
            <button type="button" onClick={() => setSelected(new Set())}>
              {t("Deselect all")}
            </button>
          ) : null}
          {groups.length > visibleGroups.length ? (
            <span>{t("Showing the latest {p0} rows.", { p0: MAX_RENDERED_RUNTIME_LOGS })}</span>
          ) : null}
        </div>
        <div className="runtime-logs-footer-actions">
          <button
            type="button"
            className="host-tool-primary"
            disabled={!chosen.length && !visibleEntries.length}
            onClick={inspect}
            title={t("Selected logs or visible errors are added to your draft for review.")}
          >
            <Bot size={15} />
            {t("Add to conversation")}
          </button>
        </div>
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
  useEffect(() => {
    if (checkbox.current)
      checkbox.current.indeterminate = selectedCount > 0 && selectedCount < group.entries.length;
  }, [selectedCount, group.entries.length]);
  return (
    <li
      className="runtime-log-row"
      data-level={runtimeLogDisplayLevel(entry)}
      data-source={entry.source}
      data-selected={selectedCount > 0}
    >
      <label className="runtime-log-select">
        <input
          ref={checkbox}
          type="checkbox"
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
                  <button type="button" onClick={() => onOpenFile(file.path, file.navigation)}>
                    {file.label}
                    {file.navigation
                      ? ":" +
                        file.navigation.line +
                        (file.navigation.column ? ":" + file.navigation.column : "")
                      : ""}
                  </button>
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
