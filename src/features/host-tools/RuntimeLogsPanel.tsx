import { errorText } from "../../shared/lib/errors";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Text } from "../../shared/ui/Text";
import { levelLabel, RuntimeLogRow } from "./ui/RuntimeLogRow";
import { useRuntimeTerminalMonitor } from "./hooks/useRuntimeTerminalMonitor";
import { MAX_POLL_FAILURES, pollDelay } from "./model/pollBackoff";
import { EmptyState } from "../../shared/ui/EmptyState";
import { FailureState } from "../../shared/ui/FailureState";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Alert } from "../../shared/ui/Alert";
import { Popover } from "../../shared/ui/Popover";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Badge } from "../../shared/ui/Badge";
import { InfoTooltip } from "../../shared/ui/InfoPopover";
import { LiveText } from "../../shared/ui/LiveText";
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
  MAX_RENDERED_RUNTIME_LOGS,
  mergeRuntimeLogs,
  runtimeLogsAgentPrompt,
  type RuntimeLogGroup,
} from "./runtimeLogsModel";
import { RuntimeLogsView } from "./model/runtimeLogsView";
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
import { toolPreferences } from "./model/toolPreferences";
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
  const [grouped, setGrouped] = useRetainedState(
    `${stateKey}:grouped`,
    saved?.grouped ?? toolPreferences.logsGrouped.load(),
  );
  const [follow, setFollow] = useRetainedState(
    `${stateKey}:follow`,
    saved?.follow ?? toolPreferences.logsFollow.load(),
  );
  const [pollInterval] = useState(toolPreferences.logsRefreshInterval.load);
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
  /** Consecutive failed reads; a transient failure retries with backoff, a run of them pauses. */
  const failures = useRef(0);
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
          const head = bufferRef.current.entries[0];
          // Entries only leave the buffer from its front, so a plain append keeps every selection.
          const leftFront = head !== undefined && next.entries[0] !== head;
          bufferRef.current = next;
          setBuffer(next);
          if (leftFront || !next.entries.length)
            setSelected((previous) => {
              if (!previous.size) return previous;
              const availableIds = new Set(next.entries.map((entry) => entry.id));
              return [...previous].some((id) => !availableIds.has(id))
                ? new Set([...previous].filter((id) => availableIds.has(id)))
                : previous;
            });
        }
        failures.current = 0;
        setLoaded(true);
        setError("");
        if (next.restarted) setNotice(t("The host restarted. A new log stream is now active."));
      } catch (cause) {
        if (alive.current && revision === generation.current) {
          setError(errorText(cause));
          failures.current += 1;
          if (failures.current >= MAX_POLL_FAILURES) {
            pausedRef.current = true;
            setPaused(true);
          }
        }
      } finally {
        pending.current = false;
        if (alive.current) {
          if (showBusy) setBusy(false);
          if (visible.current && !pausedRef.current && !document.hidden)
            timer.current = setTimeout(
              () => void read(false),
              pollDelay(pollInterval, failures.current),
            );
        }
      }
    },
    [cwd, sessionId, terminalMonitorId, pollInterval],
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

  // The view applies each poll's appended and trimmed entries; a filter change rebuilds it.
  const [logsView] = useState(() => new RuntimeLogsView());
  const view = useMemo(
    () =>
      logsView.update(
        buffer,
        {
          source: source === "all" ? undefined : source,
          sourceIds,
          levels: LEVEL_FILTERS[level],
          search,
        },
        grouped,
      ),
    [logsView, buffer, source, sourceIds, level, search, grouped],
  );
  const groups = view.groups;
  const visibleGroups = groups.slice(-MAX_RENDERED_RUNTIME_LOGS);
  const visibleEntries = visibleGroups.flatMap((group) => group.entries);
  const chosen = useMemo(
    () => buffer.entries.filter((entry) => selected.has(entry.id)),
    [buffer.entries, selected],
  );
  const { errorCount, warningCount, typeCounts } = view;
  const filteredCount = view.count;

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
  }, [buffer.cursor, filteredCount, source, sourceIds, level, search, grouped, follow, paused]);

  const togglePause = () => {
    setStarted(true);
    const next = !pausedRef.current;
    pausedRef.current = next;
    failures.current = 0;
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
        failures.current = 0;
        setPaused(false);
        // Capturing a website must not hide the project's server output.
        setSource("all");
        setSourceIds([]);
      }
      await read();
    } catch (cause) {
      if (alive.current) setActionError(errorText(cause));
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
        if (active) setActionError(errorText(cause));
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
      if (alive.current) setActionError(errorText(cause));
    } finally {
      inspectingRef.current = false;
      if (alive.current) setInspecting(false);
    }
  };
  const exportLogs = async () => {
    if (exportingRef.current) return;
    const entries = chosen.length ? chosen : view.entries();
    if (!entries.length) return;
    exportingRef.current = true;
    setExporting(true);
    setActionError("");
    const revision = generation.current;
    try {
      const content = exportRuntimeLogs(entries, buffer.sources, {
        cwd,
        hostLabel,
      });
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
      if (alive.current && revision === generation.current) setActionError(errorText(cause));
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
    : t("{p0} visible events", { p0: filteredCount });
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
            : buffer.entries.length && !filteredCount
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
    !started && !busy
      ? { label: t("Read logs"), onClick: togglePause }
      : error && !loaded
        ? undefined
        : paused && !buffer.entries.length
          ? { label: t("Resume"), onClick: togglePause }
          : buffer.entries.length && !filteredCount
            ? {
                label: t("Reset filters"),
                onClick: () => {
                  setSource("all");
                  setSourceIds([]);
                  setLevel("all");
                  setSearch("");
                },
              }
            : target.kind === "project" && loaded && !buffer.entries.length
              ? {
                  label: t("Capture a website"),
                  onClick: () => {
                    setFiltersOpen(false);
                    setMoreOpen(false);
                    setMonitorsOpen(true);
                  },
                }
              : undefined;
  const emptyRetry =
    started && !(buffer.entries.length && !filteredCount) ? () => void read() : undefined;
  const stateLabel = error
    ? t("Disconnected")
    : !started
      ? t("Stopped")
      : paused
        ? t("Paused")
        : loaded
          ? buffer.entries.length
            ? t("Live")
            : `${t("Live")} · ${t("Waiting for logs")}`
          : t("Connecting…");

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
            kind="dialog"
            aria-label={t("Log filters")}
            variant="panel"
            side="bottom"
            align="start"
            width={360}
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
                  label: value === "all" ? t("All levels") : levelLabel(value),
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
            disabledReason={t("No logs to add yet")}
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
            disabledReason={t("Logs are loading")}
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
            pressed={follow}
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
                  disabled: exporting || (!chosen.length && !filteredCount),
                },
                { kind: "sep" },
                {
                  kind: "item",
                  id: "clear",
                  label: t("Clear view"),
                  danger: true,
                },
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
          kind="dialog"
          aria-label={t("Website monitors")}
          side="bottom"
          align="end"
          width={380}
          solid
          onDismiss={() => setMonitorsOpen(false)}
          variant="panel"
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
                  disabledReason={
                    monitorBusy
                      ? t("Wait for the current monitor action")
                      : t("Enter a port or URL")
                  }
                  iconOnly
                  loading={monitorOperation?.method === "start"}
                  label={t("Open website and capture logs")}
                >
                  <Play className="icon-sm" />
                </Button>
                <Button
                  motion="none"
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={monitorBusy}
                  disabledReason={t("Wait for the current monitor action")}
                  iconOnly
                  loading={monitorOperation?.method === "list"}
                  onClick={() => void monitorAction("list")}
                  label={t("Load monitors")}
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
                      disabledReason={t("Not capturing yet")}
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
                      disabledReason={t("Wait for the current monitor action")}
                      iconOnly
                      loading={
                        monitorOperation?.method === "stop" && monitorOperation.id === monitor.id
                      }
                      label={t("Stop monitor")}
                      onClick={() => void monitorAction("stop", { id: monitor.id })}
                    >
                      <Square className="icon-sm" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </Popover>
      ) : null}
      {error ? (
        <Alert tone="danger" extra={<ErrorDetails detail={error} />}>
          {t("Could not read logs. Check the host connection and retry.")}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="danger" extra={<ErrorDetails detail={actionError} />}>
          <p>
            {actionError.includes("ERR_CONNECTION_REFUSED")
              ? t("Website is not running. Start it in Development servers, then try again.")
              : t("The action failed. Check the details and retry.")}
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
          patchToolsDraftPart(transferScope, "logs", {
            scrollTop: area.scrollTop,
          });
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
          ) : error && !loaded ? (
            <FailureState
              illustration="unreachable"
              title={t("Runtime logs")}
              description={empty}
              action={emptyAction}
              onRetry={emptyRetry}
              retryLabel={t("Refresh")}
              retrying={busy}
            />
          ) : (
            <EmptyState
              illustration={buffer.entries.length && !filteredCount ? "search-empty" : "inbox-empty"}
              title={loaded && !buffer.entries.length ? t("Waiting for logs") : t("Runtime logs")}
              description={empty}
              kind={buffer.entries.length && !filteredCount ? "filtered" : "empty"}
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
          >
            {stateLabel}
          </Badge>
        </Tooltip>
        <LiveText className="sr-only" text={stateLabel} />
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
          {groups.length > visibleGroups.length || buffer.dropped || buffer.trimmed ? (
            <InfoTooltip>
              {[
                groups.length > visibleGroups.length
                  ? t("Showing the latest {p0} rows.", {
                      p0: MAX_RENDERED_RUNTIME_LOGS,
                    })
                  : "",
                buffer.dropped || buffer.trimmed
                  ? t("{p0} older events were dropped from retained history.", {
                      p0: buffer.dropped + buffer.trimmed,
                    })
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </InfoTooltip>
          ) : null}
        </Text>
        <Text size="micro" tone="inherit" leading="inherit" className="runtime-logs-totals">
          {errorCount > 0 && <span data-level="error">{t("{p0} errors", { p0: errorCount })}</span>}
          {warningCount > 0 && (
            <span data-level="warn">{t("{p0} warnings", { p0: warningCount })}</span>
          )}
        </Text>
      </footer>
    </section>
  );
}
