import { Tooltip } from "../../shared/ui/Tooltip";
import { Text } from "../../shared/ui/Text";
import { LEVEL_LABELS, RuntimeLogRow } from "./ui/RuntimeLogRow";
import { useRuntimeTerminalMonitor } from "./hooks/useRuntimeTerminalMonitor";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Alert } from "../../shared/ui/Alert";
import { Popover } from "../../shared/ui/Popover";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Badge } from "../../shared/ui/Badge";
import { Switch } from "../../shared/ui/Switch";
import { SegmentedControl } from "../../shared/ui/SegmentedControl";
import { Select } from "../../shared/ui/Select";
import { SlidersHorizontal } from "../../shared/ui/icons";
import { TextField } from "../../shared/ui/TextField";
import { Button } from "../../shared/ui/Button";
import { FilterTrigger } from "../../shared/ui/FilterTrigger";
import { SearchInput, SearchInputGroup } from "../../shared/ui/SearchInput";
import { useRetainedState } from "../../shared/hooks/useRetainedState";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { SurfaceSelection } from "../sessions/ui/SurfaceSelection";
import { writeTextFile } from "../../platform/tauri/fs";
import { t, useLocale } from "../../shared/i18n/technical";
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
  runtimeLogsAgentPrompt,
  type RuntimeLogGroup,
} from "./runtimeLogsModel";
import type { RuntimeLogEntry, RuntimeLogSnapshot } from "./runtimeLogTypes";
import {
  patchToolsDraftPart,
  peekToolsDraftPart,
  subscribeToolsDraftTransfer,
  writeToolsDraftPart,
  type ToolsDraftScope,
} from "./toolsDraftTransfer";
import { runtimeLogDisplayLevel, type RuntimeLogDisplayLevel } from "./runtimeLogPresentation";
import { ErrorDetails } from "../../shared/ui/ErrorDetails";
import "./runtime-logs.css";

type Props = {
  transferScope?: ToolsDraftScope;
  active?: boolean;
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
  active = true,
  cwd,
  sessionId,
  composerSessionId,
  composerWindow,
  target = PROJECT_TARGET,
  hostLabel,
  onOpenFile,
  transferScope,
}: Props) {
  useLocale();
  const saved = transferScope ? peekToolsDraftPart(transferScope, "logs") : undefined;
  const [buffer, setBuffer] = useState(() => saved?.buffer ?? createRuntimeLogsBuffer());
  const bufferRef = useRef(buffer);
  const targetRef = useRef(target);
  const terminalMonitorId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const terminalMonitorSequence = useRef(0);
  const [paused, setPaused] = useState(saved?.paused ?? false);
  const pausedRef = useRef(saved?.paused ?? false);
  const [started, setStarted] = useState(saved?.started ?? true);
  const [monitorUrl, setMonitorUrl] = useState(saved?.monitorUrl ?? "");
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
  const [search, setSearch] = useRetainedState(`${stateKey}:search`, saved?.search ?? "");
  const [source, setSource] = useRetainedState<RuntimeLogEntry["source"] | "all">(
    `${stateKey}:source`,
    saved?.source ?? "all",
  );
  const [sourceIds, setSourceIds] = useRetainedState<string[]>(
    `${stateKey}:source-ids`,
    saved?.sourceIds ?? [],
  );
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [level, setLevel] = useRetainedState(`${stateKey}:level`, saved?.level ?? "all");
  const [grouped, setGrouped] = useRetainedState(`${stateKey}:grouped`, saved?.grouped ?? true);
  const [follow, setFollow] = useRetainedState(`${stateKey}:follow`, saved?.follow ?? true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(saved?.selected));
  const restoreScroll = useRef<number | undefined>(saved?.scrollTop);
  useLayoutEffect(() => {
    if (!saved) return;
    setSearch(saved.search);
    setSource(saved.source);
    setSourceIds(saved.sourceIds);
    setLevel(saved.level);
    setGrouped(saved.grouped);
    setFollow(saved.follow);
    // Snapshot owns the destination's retained filter values on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!transferScope) return;
    return subscribeToolsDraftTransfer(transferScope, ({ logs }) => {
      if (!logs) return;
      bufferRef.current = logs.buffer;
      setBuffer(logs.buffer);
      pausedRef.current = logs.paused;
      setPaused(logs.paused);
      restoreScroll.current = logs.scrollTop;
      setStarted(logs.started);
      setMonitorUrl(logs.monitorUrl);
      setSearch(logs.search);
      setSource(logs.source);
      setSourceIds(logs.sourceIds);
      setLevel(logs.level);
      setGrouped(logs.grouped);
      setFollow(logs.follow);
      setSelected(new Set(logs.selected));
    });
  }, [transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue]);
  useEffect(() => {
    if (active && transferScope)
      writeToolsDraftPart(transferScope, "logs", {
        buffer,
        search,
        source,
        sourceIds,
        level,
        grouped,
        follow,
        paused,
        started,
        monitorUrl,
        selected: [...selected],
        // Scrolling patches the snapshot directly; keep its latest value on full rewrites.
        scrollTop: peekToolsDraftPart(transferScope, "logs")?.scrollTop,
      });
  }, [
    active,
    transferScope?.cwd,
    transferScope?.sessionId,
    transferScope?.targetValue,
    buffer,
    search,
    source,
    sourceIds,
    level,
    grouped,
    follow,
    paused,
    started,
    monitorUrl,
    selected,
  ]);
  const alive = useRef(false);
  const visible = useRef(active);
  visible.current = active;
  const pending = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timeline = useRef<HTMLDivElement>(null);

  const read = useCallback(
    async (showBusy = true): Promise<void> => {
      if (!alive.current || !visible.current || pending.current || document.hidden) return;
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
            ...(!pausedRef.current
              ? {
                  terminalMonitor: {
                    id: terminalMonitorId,
                    active: true,
                    sequence: ++terminalMonitorSequence.current,
                  },
                }
              : {}),
          },
          targetRef.current,
        );
        if (!alive.current || !visible.current || revision !== generation.current) return;
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
          if (visible.current && !pausedRef.current && !document.hidden)
            timer.current = setTimeout(() => void read(false), POLL_INTERVAL);
        }
      }
    },
    [cwd, sessionId, terminalMonitorId],
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

  useRuntimeTerminalMonitor(
    cwd,
    targetRef.current,
    active,
    paused,
    terminalMonitorId,
    terminalMonitorSequence,
    timer,
    read,
  );

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
    if (area && restoreScroll.current !== undefined && !follow) {
      area.scrollTop = restoreScroll.current;
      restoreScroll.current = undefined;
    }
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

  // The icon buttons act on different scopes; say which one applies right now.
  const attachScope = chosen.length
    ? t("{p0} selected logs", { p0: chosen.length })
    : t("{p0} visible events", { p0: visibleEntries.length });
  const exportScope = chosen.length
    ? t("{p0} selected logs", { p0: chosen.length })
    : t("{p0} visible events", { p0: filtered.length });
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

  // The trigger counts and resets the popup's own filters (type, source, level);
  // the search box and grouping toggle keep their controls.
  const logFilterCount =
    (source !== "all" ? 1 : 0) + (sourceIds.length > 0 ? 1 : 0) + (level !== "all" ? 1 : 0);
  const resetLogFilters = () => {
    setSource("all");
    setSourceIds([]);
    setLevel("all");
  };
  // Each empty state offers the one local action that resolves it; the source
  // of captured output stays in the toolbar (website monitors) and the servers tool.
  const emptyAction =
    !started && !busy ? (
      <Button variant="secondary" size="sm" onClick={togglePause}>
        {t("Read logs")}
      </Button>
    ) : error && !loaded ? undefined : paused && !buffer.entries.length ? (
      <Button variant="secondary" size="sm" onClick={togglePause}>
        {t("Resume")}
      </Button>
    ) : buffer.entries.length && !filtered.length ? (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setSource("all");
          setSourceIds([]);
          setLevel("all");
          setSearch("");
        }}
      >
        {t("Reset filters")}
      </Button>
    ) : target.kind === "project" && loaded && !buffer.entries.length ? (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setFiltersOpen(false);
          setMoreOpen(false);
          setMonitorsOpen(true);
        }}
      >
        {t("Capture a website")}
      </Button>
    ) : undefined;
  const emptyRetry =
    started && !(buffer.entries.length && !filtered.length) ? () => void read() : undefined;

  return (
    <section
      className="host-tool-panel host-tool-panel-wide runtime-logs-panel"
      aria-label={t("Runtime logs")}
    >
      <div className="runtime-logs-controls">
        <div className="runtime-logs-source-picker">
          <SearchableSelect
            hideLabel
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
        <FilterTrigger
          ref={filterTrigger}
          label={t("Filters")}
          icon={<SlidersHorizontal className="icon-sm" />}
          activeCount={logFilterCount}
          onReset={resetLogFilters}
          resetLabel={t("Reset filters")}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onClick={() => {
            setMonitorsOpen(false);
            setMoreOpen(false);
            setFiltersOpen((value) => !value);
          }}
        />
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
                hideLabel
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
          <Search className="icon-sm" />
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
            tooltipDetails={[
              t("Selected logs or visible errors are added to your draft for review."),
              attachScope,
            ]}
            size="sm"
            type="button"
            disabled={!chosen.length && !visibleEntries.length}
            loading={inspecting}
            onClick={inspect}
          >
            <Bot className="icon-sm" />
          </Button>
          <Button
            motion="none"
            variant="ghost"
            iconOnly
            label={!started ? t("Read logs") : paused ? t("Resume") : t("Pause")}
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
                  description: exportScope,
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
            <Tooltip
              label={t(
                "Opens a separate browser. Capture continues until you stop the website monitor.",
              )}
              asChild
            >
              <form
                className="runtime-logs-capture-form"

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
                  label={t("Open website and capture logs")}
                  tooltip={t("Open website and capture logs")}
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
                  label={t("Load monitors")}
                  tooltip={t("Load monitors")}
                >
                  <RefreshCw className="icon-sm" />
                </Button>
              </form>
            </Tooltip>
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
                      tooltip={monitor.url}
                      tooltipWhen="overflow"
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
                      label={t("Stop monitor")}
                      tooltip={t("Stop monitor")}
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
        <Alert
          tone="danger"
          action={
            <ErrorDetails
              title={t("Could not read logs. Check the host connection and retry.")}
              detail={error}
            />
          }
        >
          <p>{t("Could not read logs. Check the host connection and retry.")}</p>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="danger" action={<ErrorDetails detail={actionError} />}>
          <p>
            {t(
              actionError.includes("ERR_CONNECTION_REFUSED")
                ? "Website is not running. Start it in Development servers, then try again."
                : "The action failed. Check the details and retry.",
            )}
          </p>
        </Alert>
      ) : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <ScrollArea
        ref={timeline}
        axis="both"
        gutter="stable"
        className="runtime-logs-timeline"
        role="region"
        aria-label={t("Log timeline")}
        tabIndex={0}
        onScroll={(event) => {
          const area = event.currentTarget;
          patchToolsDraftPart(transferScope, "logs", { scrollTop: area.scrollTop });
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
              kind={
                error && !loaded
                  ? "unavailable"
                  : buffer.entries.length && !filtered.length
                    ? "filtered"
                    : "empty"
              }
              action={emptyAction}
              onRetry={emptyRetry}
              retryLabel={t("Refresh")}
              retrying={busy}
            />
          )}
        </SurfaceSelection>
      </ScrollArea>

      <footer className="runtime-logs-footer">
        <Tooltip label={hostLabel} asChild>
          <Badge
            variant="dot"
            size="sm"
            tone={error ? "danger" : paused || !started ? "neutral" : loaded ? "success" : "info"}
            role="status"
          >
            {error
              ? t("Disconnected")
              : !started
                ? t("Stopped")
                : paused
                  ? t("Paused")
                  : loaded
                    ? buffer.entries.length
                      ? t("Live")
                      : `${t("Live")} · ${t("Waiting for logs")}`
                    : t("Connecting…")}
          </Badge>
        </Tooltip>
        <Text
          size="micro"
          tone="inherit"
          leading="inherit"
          as="div"
          className="runtime-logs-selection"
        >
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
        </Text>
        <Text size="micro" tone="inherit" leading="inherit" className="runtime-logs-totals">
          {errorCount > 0 && <span data-level="error">{t("{p0} errors", { p0: errorCount })}</span>}
          {warningCount > 0 && (
            <span data-level="warn">{t("{p0} warnings", { p0: warningCount })}</span>
          )}
        </Text>
      </footer>
      {buffer.dropped || buffer.trimmed ? (
        <Text size="micro" tone="inherit" leading="normal" as="p" className="runtime-logs-hint">
          {t("{p0} older events were dropped from retained history.", {
            p0: buffer.dropped + buffer.trimmed,
          })}
        </Text>
      ) : null}
    </section>
  );
}
