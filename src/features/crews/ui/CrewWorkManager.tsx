import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronLeft, Pencil, Plus } from "../../../shared/ui/icons";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { OpenSession } from "./CrewSessions";
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

const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));
const StartCrewDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).StartCrewDialog,
}));
type CrewState = ReturnType<typeof useProjectCrews>;

/** Where a saved crew can be used; the same wording as the editor. */
function crewScopeLabel(crew: { projectId?: string }) {
  return crew.projectId ? t("This project") : t("All projects on this host");
}

/**
 * One workspace for choosing a crew, selecting its work and opening any related session.
 * The Crew work dialog and the Crews page Work tab both render it; `layout` only changes the
 * frame (modal or page), never behavior.
 */
export function CrewWorkManager({
  cwd: homeCwd,
  state: homeState,
  definitionId,
  initialRunId,
  onOpen,
  onClose,
  layout,
}: {
  cwd: string;
  state: CrewState;
  definitionId?: string;
  initialRunId?: string;
  onOpen?: OpenSession;
  /** Dialog: closes the modal. Page: called after a session opened; usually omitted. */
  onClose?: () => void;
  layout: "dialog" | "page";
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
      onClose?.();
    }).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  const subPage =
    page === "edit" ? (
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
    ) : page === "start" ? (
      <StartCrewDialog
        cwd={cwd}
        state={state}
        definitionId={crew?.id}
        onOpen={
          onOpen
            ? async (target) => {
                await onOpen(target);
                onClose?.();
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
    ) : null;
  // The dialog swaps its content for the editor; the page keeps its work view behind the modal.
  if (subPage && layout === "dialog") return subPage;
  const crewScope = crew && savedCrew ? crewScopeLabel(crew) : undefined;
  // Without any work the empty state owns the one start action; with work the header does.
  const noWork = all.length === 0;
  // A single piece of work needs no list column; its detail is the whole view.
  const needsList = all.length > 1;
  const hideListNarrow = needsList && !!selected && pane === "detail";
  const hideDetailNarrow = needsList && pane === "list";
  const content = (
    <>
      <div className="@container/crew-management min-w-0" aria-busy={pending}>
        {layout === "page" && crew && crews.length <= 1 ? (
          <div className="flex min-w-0 items-baseline gap-2 px-4 pt-3">
            <h2 className="min-w-0 truncate text-ui-body font-medium text-content">{crew.name}</h2>
            {crewScope ? (
              <span className="shrink-0 text-ui-caption text-(--ui-text-muted)">{crewScope}</span>
            ) : null}
          </div>
        ) : null}
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
        {crew && !savedCrew ? (
          <p className="-mt-1 px-4 pb-2 text-ui-caption text-(--ui-text-secondary)">
            {t("This crew was deleted. Its work and conversations are kept.")}
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
      {subPage}
    </>
  );
  if (layout === "page") return content;
  return (
    <Modal
      padding="none"
      title={crew?.name ?? t("Crews")}
      context={crewScope}
      size="lg"
      onClose={() => {
        if (!pending) onClose?.();
      }}
    >
      {content}
    </Modal>
  );
}
