import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "../../../shared/ui/icons";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews } from "../model/crewClient";
import { crewRunMatchesQuery } from "../model/crewPresentation";
import { crewRunTitle } from "../model/crewRoster";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { CrewWorkDetail } from "./CrewWorkDetail";
import { CrewWorkList, type CrewWorkView } from "./CrewWorkList";
import { CrewWorkStatusText } from "./CrewWorkState";
import { classifyRemoteError, isConnectionFailure } from "../../connections/model/remoteFailure";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { useRemoteConnectionFeedback } from "../../connections/ui/RemoteConnectionFeedback";
import {
  crewActionError,
  crewActionErrorRecovered,
  type CrewActionError,
} from "../model/crewActionError";
import { useCrewMachineScope } from "./CrewMachineScope";

const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));
const StartCrewDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).StartCrewDialog,
}));
type CrewState = ReturnType<typeof useProjectCrews>;

/** Only query transport failures belong to the machine notice; mutations keep their own outcomes. */
function useCrewConnectionFeedback(cwd: string, state: CrewState) {
  const failure = state.error ? classifyRemoteError(state.error) : undefined;
  const connectionFailure = failure && isConnectionFailure(failure);
  const sharedConnectionIssue = useRemoteConnectionFeedback(cwd, failure);
  // Keyed on values, not the data object: a report re-renders the sidebar, so an
  // effect that ran on every new object looped forever (React #185).
  const loaded = state.isSuccess && !!state.data;
  useEffect(() => {
    if (state.error && connectionFailure) reportRemoteConnection(cwd, "crews", state.error);
    else if (loaded) reportRemoteConnection(cwd, "crews");
  }, [cwd, state.error, loaded, connectionFailure]);
  return !!connectionFailure && sharedConnectionIssue;
}

/** Where a saved crew can be used; the same wording as the editor. */
function crewScopeLabel(crew: { projectId?: string }) {
  return crew.projectId ? t("This project") : t("All projects on this host");
}
type OpenSession = (target: BackgroundSessionTarget) => void | Promise<void>;

export function CrewSidebar({
  cwd,
  onManagedChange,
  ...props
}: {
  cwd: string;
  query?: string;
  onOpen: OpenSession;
  onManagedChange: (cwd: string, ids: string[]) => void;
}) {
  const state = useProjectCrews(cwd);
  // The managed ids as one value, so the parent hears only real changes; a new
  // data object on each render must not set parent state on each render.
  const managed = state.data
    ? JSON.stringify(
        state.data.runs
          .flatMap((run) => [
            run.coordinatorSessionId,
            ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
          ])
          .filter((id): id is string => !!id),
      )
    : undefined;
  useEffect(() => {
    if (managed === undefined) return;
    onManagedChange(cwd, JSON.parse(managed) as string[]);
  }, [cwd, managed, onManagedChange]);
  return <CrewSessions cwd={cwd} state={state} {...props} />;
}

/** Navigation stays compact. All operations and conversations live in one work view. */
export function CrewSessions({
  cwd,
  state,
  query = "",
  definitionId,
  onOpen,
}: {
  cwd: string;
  state: CrewState;
  query?: string;
  definitionId?: string;
  onOpen?: OpenSession;
}) {
  useLocale();
  const [opened, setOpened] = useState<{
    definitionId?: string;
    runId?: string;
  } | null>(null);
  const data = state.data;
  const sharedConnectionIssue = useCrewConnectionFeedback(cwd, state);
  const q = query.trim();
  const runs = [...(data?.runs ?? [])]
    .filter(
      (run) => run.status !== "finished" && (!definitionId || run.definition.id === definitionId),
    )
    .filter((run) => crewRunMatchesQuery(run, q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!data && !state.error) return null;
  if (data && !data.runs.length && !data.definitions.length && !state.error) return null;
  return (
    // A quiet section label on the list's gutter. With nothing running it is only this one
    // line (and Manage), so an idle project spends no rows on an empty state.
    <section aria-label={t("Crew work")} className="px-1.5 pt-1">
      <div className="flex min-h-7 items-center gap-1 ps-2.5 pe-0.5">
        <span className="min-w-0 flex-1 text-ui-caption font-medium text-(--ui-text-muted)">
          {t("Crew work")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!data}
          onClick={() => setOpened({ definitionId })}
        >
          {t("Manage")}
        </Button>
      </div>
      {state.error && !sharedConnectionIssue ? (
        <Button variant="ghost" onClick={() => void state.refetch()} tooltip={state.error.message}>
          {t("Crew host unavailable. Retry")}
        </Button>
      ) : null}
      {sharedConnectionIssue && !data ? (
        <p role="status" className="px-2.5 py-1 text-ui-caption text-(--ui-text-muted)">
          {t("Not connected")}
        </p>
      ) : null}
      <div className="flex flex-col gap-px empty:hidden">
        {runs.map((run) => (
          <Button
            key={run.id}
            data-crew-work-link={run.id}
            variant="item"
            motion="none"
            className="min-w-0 w-full"
            onClick={() => setOpened({ definitionId: run.definition.id, runId: run.id })}
            tooltip={crewRunTitle(run)}
            tooltipWhen="overflow"
          >
            <span className="min-w-0 flex-1 text-start">
              <span className="block truncate font-medium">{crewRunTitle(run)}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-2 text-ui-caption text-(--ui-text-secondary)">
                <span className="truncate">{run.definition.name}</span>
                <CrewWorkStatusText run={run} />
              </span>
            </span>
            <ChevronRight className="icon-sm shrink-0" />
          </Button>
        ))}
      </div>
      {opened ? (
        <CrewManagementDialog
          cwd={cwd}
          state={state}
          definitionId={opened.definitionId}
          initialRunId={opened.runId}
          onOpen={onOpen}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </section>
  );
}

/** One workspace for choosing a crew, selecting its work and opening any related session. */
export function CrewManagementDialog({
  cwd: homeCwd,
  state: homeState,
  definitionId,
  initialRunId,
  onOpen,
  onClose,
}: {
  cwd: string;
  state: CrewState;
  definitionId?: string;
  initialRunId?: string;
  onOpen?: OpenSession;
  onClose: () => void;
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
  const [page, setPage] = useState<"work" | "start" | "edit">("work");
  // Narrow windows show the work list or one work at a time; wide ones show both.
  const [pane, setPane] = useState<"list" | "detail">(initialRunId ? "detail" : "list");
  const [editorReturn, setEditorReturn] = useState<"work" | "start">("work");
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
  const pendingGate = useRef(false);
  const [actionError, setActionError] = useState<CrewActionError>();
  const error = actionError?.message ?? "";
  const setError = (message: string) =>
    setActionError(message ? { message, at: Date.now(), connection: false } : undefined);
  // A failure to reach the machine is retired once the machine answers a read again.
  if (crewActionErrorRecovered(actionError, state.dataUpdatedAt)) setActionError(undefined);
  // The filter belongs to the dialog, so polling and the edit/start pages never reset it.
  const [query, setQuery] = useState("");
  const data = state.data;
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
  const crew = crews.find((item) => item.id === crewId) ?? crews[0];
  const savedCrew = !!data?.definitions.some((item) => item.id === crew?.id);
  const all = [...(data?.runs ?? [])]
    .filter((run) => run.definition.id === crew?.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = all.find((run) => run.id === selectedId);
  const selectedView = pinned ? (pinned.status === "finished" ? "finished" : "ongoing") : view;
  if (selectedView !== view) setView(selectedView);
  const listed = all.filter((run) =>
    selectedView === "finished" ? run.status === "finished" : run.status !== "finished",
  );
  // Selection resolves from the whole view; the filter only narrows what the list shows.
  const visible = listed.filter((run) => crewRunMatchesQuery(run, query));
  const selected = listed.find((run) => run.id === selectedId) ?? listed[0];
  const resolvedRunId = selected?.id;
  const resolvedCrewId = crew?.id;
  // Reconcile removed records during render so a poll cannot replace an unpinned selection.
  if (resolvedRunId && resolvedRunId !== selectedId) setSelectedId(resolvedRunId);
  if (resolvedCrewId && resolvedCrewId !== crewId) setCrewId(resolvedCrewId);
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
      onClose();
    }).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  if (page === "edit")
    return (
      <CrewEditDialog
        cwd={cwd}
        crewId={savedCrew ? crew?.id : undefined}
        createScope={savedCrew ? undefined : "project"}
        initialPage="team"
        onStart={(id) => {
          setCrewId(id);
          setPage("start");
        }}
        onClose={() => setPage(editorReturn)}
      />
    );
  if (page === "start")
    return (
      <StartCrewDialog
        cwd={cwd}
        state={state}
        definitionId={crew?.id}
        onOpen={
          onOpen
            ? async (target) => {
                await onOpen(target);
                onClose();
              }
            : undefined
        }
        onEdit={(id) => {
          setCrewId(id);
          setEditorReturn("start");
          setPage("edit");
        }}
        onClose={() => setPage("work")}
      />
    );
  const crewScope = crew && savedCrew ? crewScopeLabel(crew) : undefined;
  // Without any work the empty state owns the one start action; with work the header does.
  const noWork = all.length === 0;
  // A single piece of work needs no list column; its detail is the whole view.
  const needsList = all.length > 1;
  const hideListNarrow = needsList && !!selected && pane === "detail";
  const hideDetailNarrow = needsList && pane === "list";
  return (
    <Modal
      padding="none"
      title={crew?.name ?? t("Crews")}
      context={crewScope}
      size="lg"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div className="@container/crew-management min-w-0" aria-busy={pending}>
        <div className="flex flex-wrap items-end gap-2 px-4 pb-2 pt-2">
          {scope.picker(pending)}
          {scope.projectPicker(pending)}
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
                  setError("");
                }}
              />
            </div>
          ) : null}
          {/* Where on the left, what to do on the right; the crew summary sits under the row. */}
          <div className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant={savedCrew ? (noWork ? "secondary" : "ghost") : "primary"}
              disabled={!data || pending}
              startIcon={savedCrew ? <Pencil className="icon-sm" /> : <Plus className="icon-sm" />}
              tooltip={
                savedCrew
                  ? t("Changes apply to future work. Work already started keeps its own team.")
                  : undefined
              }
              onClick={() => {
                setEditorReturn("work");
                setPage("edit");
              }}
            >
              {savedCrew ? t("Edit crew") : t("New crew")}
            </Button>
            {savedCrew && !noWork ? (
              <Button
                variant="primary"
                disabled={!crew || pending}
                startIcon={<Plus className="icon-sm" />}
                onClick={() => setPage("start")}
              >
                {t("New work")}
              </Button>
            ) : null}
          </div>
        </div>
        {crew ? (
          <p className="-mt-1 px-4 pb-2 text-ui-caption text-(--ui-text-secondary)">
            {savedCrew
              ? `${t("{p0} members", { p0: crew.agents.length })} · ${t("Saved team for future work")}`
              : t("This crew was deleted. Its work and conversations are kept.")}
          </p>
        ) : null}
        {!data ? (
          <div className="p-4">
            <Alert tone={state.error ? "danger" : "info"}>
              {state.error?.message ?? t("Loading crews…")}
            </Alert>
            <Button variant="ghost" onClick={() => void state.refetch()}>
              {t("Retry")}
            </Button>
          </div>
        ) : noWork ? (
          <div className="px-4 pb-4">
            {data.catalogError || state.error ? (
              <div className="pb-3">
                <Alert
                  tone="warning"
                  action={
                    <Button variant="ghost" onClick={() => void state.refetch()}>
                      {t("Retry")}
                    </Button>
                  }
                >
                  {data.catalogError ?? state.error?.message}
                </Alert>
              </div>
            ) : null}
            {error ? (
              <div className="pb-3">
                <Alert tone="danger">{error}</Alert>
              </div>
            ) : null}
            <EmptyState
              context="panel"
              kind="empty"
              title={t("No crew work yet")}
              description={
                savedCrew
                  ? t(
                      "Use New work to give this crew a delivery. Its progress and decisions appear here.",
                    )
                  : crew
                    ? t("This crew has no work history.")
                    : t("Create a crew, then start work with it.")
              }
              action={
                savedCrew ? (
                  <Button
                    variant="primary"
                    disabled={!crew || pending}
                    startIcon={<Plus className="icon-sm" />}
                    onClick={() => setPage("start")}
                  >
                    {t("New work")}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div
            className={`grid min-w-0 ${needsList && selected ? "@min-[640px]/crew-management:grid-cols-[264px_minmax(0,1fr)]" : ""}`}
          >
            {needsList ? (
              <div
                className={`[&>nav]:h-full ${hideListNarrow ? "hidden @min-[640px]/crew-management:block" : ""}`}
              >
                <CrewWorkList
                  view={selectedView}
                  ongoingCount={all.filter((run) => run.status !== "finished").length}
                  runs={visible}
                  listedCount={listed.length}
                  query={query}
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
                    setError("");
                  }}
                  onQueryChange={setQuery}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setPane("detail");
                    setError("");
                  }}
                />
              </div>
            ) : null}
            {selected || data.catalogError || state.error || error ? (
              <div
                className={`min-w-0 p-4 @min-[640px]/crew-management:min-h-64 ${hideDetailNarrow ? "hidden @min-[640px]/crew-management:block" : ""}`}
              >
                {needsList && selected ? (
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
                  <Alert
                    tone="warning"
                    action={
                      <Button variant="ghost" onClick={() => void state.refetch()}>
                        {t("Retry")}
                      </Button>
                    }
                  >
                    {data.catalogError}
                  </Alert>
                ) : null}
                {state.error ? (
                  <Alert
                    tone="warning"
                    action={
                      <Button variant="ghost" onClick={() => void state.refetch()}>
                        {t("Retry")}
                      </Button>
                    }
                  >
                    {state.error.message}
                  </Alert>
                ) : null}
                {selected ? (
                  <CrewWorkDetail
                    key={selected.id}
                    run={selected}
                    savedCrew={savedCrew ? crew : undefined}
                    catalog={data.catalog}
                    pending={pending}
                    pendingAction={pendingAction}
                    error={error}
                    canOpen={!!onOpen}
                    onOpen={open}
                    canDelete={!!data.runDeleteSupported}
                    stopRequested={stoppedRuns.has(selected.id)}
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
                        await state.call("crews.stop", { runId: selected.id });
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
                ) : error ? (
                  <Alert tone="danger">{error}</Alert>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
