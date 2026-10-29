import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronRight, Pencil, Play, Plus } from "../../../shared/ui/icons";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews } from "../model/crewClient";
import { crewRunMatchesQuery } from "../model/crewPresentation";
import { crewRunTitle } from "../model/crewRoster";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { CrewWorkDetail } from "./CrewWorkDetail";
import { CrewWorkList, type CrewWorkView } from "./CrewWorkList";
import { CrewWorkStatusText } from "./CrewWorkState";

const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));
const StartCrewDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).StartCrewDialog,
}));
type CrewState = ReturnType<typeof useProjectCrews>;
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
  useEffect(() => {
    if (!state.data) return;
    onManagedChange(
      cwd,
      state.data.runs
        .flatMap((run) => [
          run.coordinatorSessionId,
          ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
        ])
        .filter((id): id is string => !!id),
    );
  }, [cwd, state.data, onManagedChange]);
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
  const [opened, setOpened] = useState<{ definitionId?: string; runId?: string } | null>(null);
  const data = state.data;
  const q = query.trim();
  const runs = [...(data?.runs ?? [])]
    .filter(
      (run) => run.status !== "finished" && (!definitionId || run.definition.id === definitionId),
    )
    .filter((run) => crewRunMatchesQuery(run, q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!data && !state.error) return null;
  if (data && !data.runs.length && !data.definitions.length) return null;
  return (
    <section
      aria-label={t("Crew work")}
      className="px-2 py-2"
    >
      <div className="flex min-h-7 items-center gap-1 px-1">
        <span className="min-w-0 flex-1 text-ui-caption font-medium text-(--ui-text-secondary)">
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
      {state.error ? (
        <Button variant="ghost" onClick={() => void state.refetch()} title={state.error.message}>
          {t("Crew host unavailable. Retry")}
        </Button>
      ) : null}
      <div className="flex flex-col gap-px">
        {runs.map((run) => (
          <Button
            key={run.id}
            data-crew-work-link={run.id}
            variant="item"
            motion="none"
            className="min-w-0 w-full"
            onClick={() => setOpened({ definitionId: run.definition.id, runId: run.id })}
            title={crewRunTitle(run)}
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
        {!runs.length ? (
          <p className="px-1 py-1 text-ui-caption text-(--ui-text-secondary)">
            {q ? t("No matching crew work.") : t("No ongoing crew work.")}
          </p>
        ) : null}
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
  cwd,
  state,
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
  const [crewId, setCrewId] = useState(definitionId ?? "");
  const [selectedId, setSelectedId] = useState(initialRunId ?? "");
  const [view, setView] = useState<CrewWorkView>(
    state.data?.runs.find((run) => run.id === initialRunId)?.status === "finished"
      ? "finished"
      : "ongoing",
  );
  const [page, setPage] = useState<"work" | "start" | "edit">("work");
  const [editorReturn, setEditorReturn] = useState<"work" | "start">("work");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pending = pendingAction !== null;
  const pendingGate = useRef(false);
  const [error, setError] = useState("");
  // The filter belongs to the dialog, so polling and the edit/start pages never reset it.
  const [query, setQuery] = useState("");
  const data = state.data;
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
  const act = async (key: string, operation: () => Promise<unknown>) => {
    if (pendingGate.current) return;
    pendingGate.current = true;
    setPendingAction(key);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPendingAction(null);
    }
  };
  const open = (sessionId: string, source = sessionId) => {
    if (!data || !onOpen) return;
    void act(`open:${source}`, async () => {
      await onOpen({ cwd, machineId: data.machine.id, projectId: data.project.id, sessionId });
      onClose();
    });
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
  return (
    <Modal
      title={crew?.name ?? t("Crews")}
      size="lg"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div className="@container/crew-management min-w-0" aria-busy={pending}>
        <div className="flex flex-wrap items-end gap-2 px-4 pb-3 pt-2">
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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {crew && savedCrew ? (
              <span className="me-auto flex min-w-0 flex-col text-ui-caption">
                <span className="text-(--ui-text-muted)">{t("Saved team for future work")}</span>
                <span className="text-(--ui-text-secondary)">
                  {t("{p0} members", { p0: crew.agents.length })}
                </span>
              </span>
            ) : (
              <span className="me-auto" />
            )}
            <Button
              variant={savedCrew ? "ghost" : "primary"}
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
            {savedCrew ? (
              <Button
                variant={selected ? "secondary" : "primary"}
                disabled={!crew || pending}
                startIcon={<Play className="icon-sm" />}
                onClick={() => setPage("start")}
              >
                {t("Start work")}
              </Button>
            ) : null}
          </div>
        </div>
        {crew && !savedCrew ? (
          <p className="px-4 pb-2 text-ui-caption text-(--ui-text-secondary)">
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
        ) : (
          <div className="grid min-w-0 @min-[640px]/crew-management:grid-cols-[264px_minmax(0,1fr)]">
            <CrewWorkList
              view={selectedView}
              ongoingCount={all.filter((run) => run.status !== "finished").length}
              runs={visible}
              listedCount={listed.length}
              query={query}
              selectedId={selected?.id}
              disabled={pending}
              onViewChange={(next) => {
                if (pendingGate.current) return;
                setView(next);
                setSelectedId("");
                setError("");
              }}
              onQueryChange={setQuery}
              onSelect={(id) => {
                setSelectedId(id);
                setError("");
              }}
            />
            <div className="min-w-0 p-4 @min-[640px]/crew-management:min-h-64">
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
                  onPause={() =>
                    void act(`pause:${selected.id}`, () =>
                      state.call(selected.status === "paused" ? "crews.resume" : "crews.pause", {
                        runId: selected.id,
                      }),
                    )
                  }
                  onStop={() =>
                    void act(`stop:${selected.id}`, () =>
                      state.call("crews.stop", { runId: selected.id }),
                    )
                  }
                  onDelete={() =>
                    void act(`delete:${selected.id}`, () =>
                      state.call("crews.deleteRun", {
                        runId: selected.id,
                        expectedUpdatedAt: selected.updatedAt,
                      }),
                    )
                  }
                />
              ) : (
                <div className="flex min-h-40 flex-col items-start justify-center gap-3">
                  {error ? <Alert tone="danger">{error}</Alert> : null}
                  <p className="text-ui-body text-(--ui-text-secondary)">
                    {view === "ongoing" ? t("No ongoing crew work.") : t("No finished crew work.")}
                  </p>
                  {savedCrew ? (
                    <Button variant="secondary" onClick={() => setPage("start")}>
                      {t("Start work")}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
