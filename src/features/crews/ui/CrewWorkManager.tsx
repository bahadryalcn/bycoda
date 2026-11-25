import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BackgroundSessionTarget } from "../../tasks";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { FailureState } from "../../../shared/ui/FailureState";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronLeft } from "../../../shared/ui/icons";
import type { useProjectCrews } from "../model/crewClient";
import { crewRunMatchesQuery } from "../model/crewPresentation";
import {
  crewActionError,
  crewActionErrorRecovered,
  type CrewActionError,
} from "../model/crewActionError";
import { CrewWorkDetail } from "./CrewWorkDetail";
import { CrewWorkList, type CrewWorkView } from "./CrewWorkList";
import { useCrewMachineScope } from "./CrewMachineScope";
import { FailureAlert } from "./FailureAlert";

type CrewState = ReturnType<typeof useProjectCrews>;

/** Opens a crew's coordinator or work session; the host supplies it. */
export type OpenCrewSession = (target: BackgroundSessionTarget) => void | Promise<void>;

/** The work filter earns its place only for a long list, as the roster filter does. */
const WORK_SEARCH_MIN = 7;

/**
 * The Work tab: choose a crew, select its work and open any related session. Starting work,
 * editing and creating crews belong to the page header and the Teams menu, not to this view.
 */
export function CrewWorkManager({
  cwd: homeCwd,
  state: homeState,
  definitionId,
  initialRunId,
  onOpen,
  onCrewChange,
  renderCoordinator,
}: {
  cwd: string;
  state: CrewState;
  definitionId?: string;
  initialRunId?: string;
  onOpen?: OpenCrewSession;
  /** The crew whose work is shown, so the page's "New work" starts work for that crew. */
  onCrewChange?: (crewId: string | undefined) => void;
  renderCoordinator?: (target: BackgroundSessionTarget) => ReactNode;
}) {
  useLocale();
  const scope = useCrewMachineScope(homeCwd, homeState);
  const { cwd, state } = scope;
  const [scopedCwd, setScopedCwd] = useState(cwd);
  const [crewId, setCrewId] = useState(definitionId ?? "");
  const [selectedId, setSelectedId] = useState(initialRunId ?? "");
  const [view, setView] = useState<CrewWorkView>(
    state.data?.runs.find((run) => run.id === initialRunId)?.status === "finished"
      ? "finished"
      : "ongoing",
  );
  // Narrow windows show the work list or one work at a time; wide ones show both.
  const [pane, setPane] = useState<"list" | "detail">(initialRunId ? "detail" : "list");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // Works the owner stopped: the lead's cancel can take a moment to land, and Stop must not
  // stay offered for work that was already told to stop. Resuming clears it.
  const [stoppedRuns, setStoppedRuns] = useState<ReadonlySet<string>>(() => new Set());
  const markStopped = (id: string, stopped: boolean) =>
    setStoppedRuns((current) => {
      const next = new Set(current);
      if (stopped) next.add(id);
      else next.delete(id);
      return next;
    });
  const pending = pendingAction !== null;
  // The presented (translated or classified) read failure; the raw text goes behind Details.
  const { visibleError: loadNotice } = state;
  const pendingGate = useRef(false);
  const [actionError, setActionError] = useState<CrewActionError>();
  // A failure to reach the machine is retired once the machine answers a read again.
  if (crewActionErrorRecovered(actionError, state.dataUpdatedAt)) setActionError(undefined);
  // The filter belongs to this view, so polling never resets it.
  const [query, setQuery] = useState("");
  const data = state.data;
  // A run opened by id before the list loaded picks its tab once, when the list first arrives;
  // after that the tab is only the owner's choice.
  const [initialViewPending, setInitialViewPending] = useState(!!initialRunId && !state.data);
  if (initialViewPending && data) {
    setInitialViewPending(false);
    if (data.runs.find((run) => run.id === initialRunId)?.status === "finished") {
      setView("finished");
    }
  }
  const refreshShownCentrally = useConnectionErrorShownCentrally(state.error);
  // Another machine has its own crews and work; nothing selected here applies there.
  if (scopedCwd !== cwd) {
    setScopedCwd(cwd);
    setCrewId(definitionId ?? "");
    setSelectedId("");
    setView("ongoing");
    setQuery("");
    setActionError(undefined);
  }
  const crews = [...(data?.definitions ?? [])];
  for (const run of data?.runs ?? []) {
    if (!crews.some((item) => item.id === run.definition.id)) crews.push(run.definition);
  }
  // A run opened by id belongs to its own crew even when no crew was named.
  const pinnedCrewId = data?.runs.find((run) => run.id === selectedId)?.definition.id;
  const crew = crews.find((item) => item.id === (crewId || pinnedCrewId)) ?? crews[0];
  const savedCrew = !!data?.definitions.some((item) => item.id === crew?.id);
  const all = [...(data?.runs ?? [])]
    .filter((run) => run.definition.id === crew?.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  // The tab is the owner's choice: a poll that finishes the open run never switches it.
  const listed = all.filter((run) =>
    view === "finished" ? run.status === "finished" : run.status !== "finished",
  );
  // The filter only narrows what the list shows.
  const visible = listed.filter((run) => crewRunMatchesQuery(run, query));
  // The open run is looked up in the whole crew, not the tab, so a status change keeps it open.
  // An explicit selection that vanished is reported ("gone"), never replaced by another run.
  // A selection that belongs to another crew (the crew changed) falls back to this crew's first run.
  const pinned = selectedId ? all.find((run) => run.id === selectedId) : undefined;
  const gone = !!data && !!selectedId && !data.runs.some((run) => run.id === selectedId);
  const selected = pinned ?? (gone ? undefined : listed[0]);
  const resolvedRunId = selected?.id;
  const resolvedCrewId = crew?.id;
  // Pin the default (first listed) run once, so later polls cannot swap it under the owner.
  if (resolvedRunId && resolvedRunId !== selectedId) setSelectedId(resolvedRunId);
  if (resolvedCrewId && resolvedCrewId !== crewId) setCrewId(resolvedCrewId);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- The crew is resolved here from polled data, so no handler sees it change; the page's New work action needs it.
  useEffect(() => {
    onCrewChange?.(resolvedCrewId);
  }, [onCrewChange, resolvedCrewId]);
  const act = async (key: string, label: string, operation: () => Promise<unknown>) => {
    if (pendingGate.current) return;
    pendingGate.current = true;
    setPendingAction(key);
    setActionError(undefined);
    try {
      await operation();
    } catch (reason) {
      setActionError(crewActionError(reason, label, data?.machine, Date.now()));
    } finally {
      pendingGate.current = false;
      setPendingAction(null);
    }
  };
  const open = (sessionId: string, source = sessionId) => {
    if (!data || !onOpen) return;
    void act(`open:${source}`, t("Open session"), async () => {
      await onOpen({
        cwd,
        machineId: data.machine.id,
        projectId: data.project.id,
        sessionId,
      });
    });
  };
  const noWork = all.length === 0;
  // A single piece of work needs no list column; its detail is the whole view.
  const needsList = all.length > 1;
  const hasDetail = !!selected || gone;
  const hideListNarrow = needsList && hasDetail && pane === "detail";
  const hideDetailNarrow = needsList && pane === "list";
  // The lead's conversation is rendered inline, so the session list does not repeat it.
  const coordinatorInline = !!(selected?.coordinatorSessionId && renderCoordinator);
  return (
    <>
      <div className="@container/crew-management min-w-0" aria-busy={pending}>
        <div className="flex flex-wrap items-end gap-2 px-4 pb-2 pt-2 empty:hidden">
          {scope.picker(pending)}
          {/* Read-only work view: the project is chosen elsewhere, shown only when scoped away from home. */}
          {cwd !== homeCwd ? scope.projectPicker(pending, false, false) : null}
          {data && crews.length > 1 ? (
            <div className="min-w-0 flex-1 basis-48">
              <SearchableSelect
                label={t("Crew")}
                value={crew?.id ?? ""}
                options={crews.map((item) => ({
                  value: item.id,
                  label: item.name,
                  description: data.definitions.some((saved) => saved.id === item.id)
                    ? undefined
                    : t("Deleted"),
                }))}
                disabled={pending}
                onChange={(id) => {
                  setCrewId(id);
                  setSelectedId("");
                  setView("ongoing");
                  setQuery("");
                  setActionError(undefined);
                }}
              />
            </div>
          ) : null}
        </div>
        {crew && !savedCrew ? (
          <InlineMessage tone="neutral" live="off" inset="panel">
            {t("This crew was deleted. Its work and conversations are kept.")}
          </InlineMessage>
        ) : null}
        {!data ? (
          <div className="p-4">
            {state.visibleError ? (
              <FailureState
                context="panel"
                title={t("Could not load crews")}
                description={loadNotice}
                error={state.errorDetails}
                onRetry={() => state.refetch()}
              />
            ) : (
              <LoadingText layout="fill">{t("Loading crews…")}</LoadingText>
            )}
          </div>
        ) : noWork ? (
          <div className="px-4 pb-4">
            {data.catalogError || (state.visibleError && !refreshShownCentrally) ? (
              <div className="pb-3">
                <InlineError
                  details={data.catalogError ?? state.visibleError}
                  retry={{ onRetry: () => void state.refetch(), label: t("Retry") }}
                />
              </div>
            ) : null}
            {actionError ? (
              <div className="pb-3">
                <FailureAlert title={actionError.title} detail={actionError.detail} />
              </div>
            ) : null}
            <EmptyState context="panel" kind="empty" title={t("No crew work yet")} />
          </div>
        ) : (
          <div
            className={`grid min-w-0 ${needsList && hasDetail ? "@min-[640px]/crew-management:grid-cols-[264px_minmax(0,1fr)]" : ""}`}
          >
            {needsList ? (
              <div
                className={`[&>div]:h-full ${hideListNarrow ? "hidden @min-[640px]/crew-management:block" : ""}`}
              >
                <CrewWorkList
                  view={view}
                  ongoingCount={all.filter((run) => run.status !== "finished").length}
                  runs={visible}
                  listedCount={listed.length}
                  query={query}
                  searchable={listed.length >= WORK_SEARCH_MIN || !!query.trim()}
                  selectedId={selected?.id}
                  disabled={pending}
                  hasMoreHistory={state.hasMoreHistory}
                  historyLoading={state.historyLoading}
                  historyError={state.historyError}
                  onLoadMore={() => void state.loadMoreHistory()}
                  onViewChange={(next) => {
                    if (pendingGate.current) return;
                    setView(next);
                    setSelectedId("");
                    setActionError(undefined);
                  }}
                  onQueryChange={setQuery}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setPane("detail");
                    setActionError(undefined);
                  }}
                />
              </div>
            ) : null}
            {hasDetail ||
            data.catalogError ||
            (state.visibleError && !refreshShownCentrally) ||
            actionError ? (
              <div
                className={`min-w-0 p-4 @min-[640px]/crew-management:min-h-64 ${hideDetailNarrow ? "hidden @min-[640px]/crew-management:block" : ""}`}
              >
                {needsList && hasDetail ? (
                  <div className="-mt-1 mb-2 @min-[640px]/crew-management:hidden">
                    <Button
                      variant="ghost"
                      size="sm"
                      startIcon={<ChevronLeft className="icon-sm" />}
                      disabled={pending}
                      onClick={() => setPane("list")}
                    >
                      {t("Back to work list")}
                    </Button>
                  </div>
                ) : null}
                {data.catalogError ? (
                  <InlineError
                    details={data.catalogError}
                    retry={{ onRetry: () => void state.refetch(), label: t("Retry") }}
                  />
                ) : null}
                {state.visibleError && !refreshShownCentrally ? (
                  <InlineError
                    details={state.visibleError}
                    retry={{ onRetry: () => void state.refetch(), label: t("Retry") }}
                  />
                ) : null}
                {selected?.coordinatorSessionId && renderCoordinator ? (
                  <div
                    className="flex min-h-96 flex-col h-[min(70dvh,800px)]"
                    data-crew-coordinator
                  >
                    {renderCoordinator({
                      cwd,
                      machineId: data.machine.id,
                      projectId: data.project.id,
                      sessionId: selected.coordinatorSessionId,
                    })}
                  </div>
                ) : null}
                {gone ? (
                  <InlineMessage
                    tone="neutral"
                    action={{
                      label: t("Choose other work"),
                      onClick: () => setSelectedId(""),
                    }}
                  >
                    {t("This work no longer exists.")}
                  </InlineMessage>
                ) : null}
                {selected ? (
                  <CrewWorkDetail
                    key={selected.id}
                    run={selected}
                    savedCrew={savedCrew ? crew : undefined}
                    catalog={data.catalog}
                    pending={pending}
                    pendingAction={pendingAction}
                    error={actionError}
                    canOpen={!!onOpen}
                    onOpen={open}
                    canDelete={!!data.runDeleteSupported}
                    coordinatorInline={coordinatorInline}
                    stopRequested={stoppedRuns.has(selected.id)}
                    ownerTools={{
                      machineId: data.machine.id,
                      call: state.call,
                      tasksSupported: !!data.taskExecutionSupported,
                    }}
                    onPause={() =>
                      void act(
                        `pause:${selected.id}`,
                        selected.status === "paused"
                          ? t("Resume work")
                          : t("Pause new assignments"),
                        async () => {
                          const resuming = selected.status === "paused";
                          await state.call(resuming ? "crews.resume" : "crews.pause", {
                            runId: selected.id,
                          });
                          if (resuming) markStopped(selected.id, false);
                        },
                      )
                    }
                    onStop={() =>
                      void act(`stop:${selected.id}`, t("Stop work"), async () => {
                        await state.call("crews.stop", {
                          runId: selected.id,
                        });
                        markStopped(selected.id, true);
                      })
                    }
                    onDelete={() =>
                      void act(`delete:${selected.id}`, t("Delete work"), async () => {
                        await state.call("crews.deleteRun", {
                          runId: selected.id,
                          expectedUpdatedAt: selected.updatedAt,
                        });
                        // The work is gone: a narrow window goes back to the list.
                        setPane("list");
                      })
                    }
                  />
                ) : actionError ? (
                  <FailureAlert title={actionError.title} detail={actionError.detail} />
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
