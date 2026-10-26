import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Modal } from "../../../shared/ui/Modal";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import {
  Bot,
  ChevronRight,
  CodeBlock,
  Pause,
  Pencil,
  Play,
  Plus,
  Shield,
  Square,
  Trash2,
} from "../../../shared/ui/icons";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews, type CrewRunView } from "../model/crewClient";
import { crewRunTitle } from "../model/crewRoster";
import {
  crewCanStop,
  crewActivityKnown,
  crewHasRunningWork,
  crewWorkStatus,
  crewWorkStatusLabel,
} from "../model/crewPresentation";
import { lazySurface } from "../../../shared/ui/lazySurface";

const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));
const StartCrewDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).StartCrewDialog,
}));
type CrewState = ReturnType<typeof useProjectCrews>;
type OpenSession = (target: BackgroundSessionTarget) => void | Promise<void>;

function sessionCount(run: CrewRunView) {
  return new Set(
    [
      run.coordinatorSessionId,
      ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
    ].filter(Boolean),
  ).size;
}
function runStatus(run: CrewRunView) {
  return run.status === "finished" ? t("Done") : crewWorkStatusLabel(crewWorkStatus(run));
}
function statusTone(run: CrewRunView): BadgeTone {
  if (run.status === "finished") return "success";
  const status = crewWorkStatus(run);
  return status === "input"
    ? "warning"
    : status === "blocked"
      ? "danger"
      : status === "working"
        ? "info"
        : "neutral";
}
function progressLabel(run: CrewRunView) {
  return run.tasks.length
    ? t("{p0}/{p1} tasks", {
        p0: run.tasks.filter((task) => task.status === "done").length,
        p1: run.tasks.length,
      })
    : run.status === "active" && run.coordinatorStatus === "running"
      ? t("Planning")
      : t("No assignments yet");
}
function taskStatusLabel(status: string) {
  return status === "verifying"
    ? t("Reviewing")
    : status === "review"
      ? t("Awaiting acceptance")
      : status === "blocked"
        ? t("Blocked")
        : status === "done"
          ? t("Done")
          : status === "queued"
            ? t("Queued")
            : status === "todo"
              ? t("To do")
              : t("Working");
}

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
  const q = query.trim().toLocaleLowerCase();
  const runs = [...(data?.runs ?? [])]
    .filter(
      (run) => run.status !== "finished" && (!definitionId || run.definition.id === definitionId),
    )
    .filter(
      (run) =>
        !q ||
        `${crewRunTitle(run)} ${run.launch?.prompt ?? ""} ${run.definition.name} ${run.tasks.map((task) => task.title).join(" ")} ${run.definition.agents.map((agent) => agent.name).join(" ")} ${run.assignments.map((assignment) => assignment.title).join(" ")}`
          .toLocaleLowerCase()
          .includes(q),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!data && !state.error) return null;
  if (data && !data.runs.length && !data.definitions.length) return null;
  return (
    <section
      aria-label={t("Crew work")}
      className="border-b border-(--ui-tone-neutral-border) px-2 py-2"
    >
      <div className="flex items-center gap-1 px-1 pb-1">
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
                <span className="shrink-0">{runStatus(run)}</span>
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
  const [view, setView] = useState<"ongoing" | "finished">(
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
        <div className="flex flex-wrap items-end gap-2 border-b border-(--ui-tone-neutral-border) px-4 pb-3 pt-2">
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
                  setError("");
                }}
              />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {crew ? (
              <span className="me-auto text-ui-caption text-(--ui-text-secondary)">
                {t("{p0} members", { p0: crew.agents.length })}
              </span>
            ) : null}
            <Button
              variant={savedCrew ? "ghost" : "primary"}
              disabled={!data || pending}
              startIcon={savedCrew ? <Pencil className="icon-sm" /> : <Plus className="icon-sm" />}
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
                startIcon={<Plus className="icon-sm" />}
                onClick={() => setPage("start")}
              >
                {t("Start work")}
              </Button>
            ) : null}
          </div>
        </div>
        {crew && !savedCrew ? (
          <p className="border-b border-(--ui-tone-neutral-border) px-4 py-2 text-ui-caption text-(--ui-text-secondary)">
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
          <div className="grid min-w-0 @min-[640px]/crew-management:grid-cols-[240px_minmax(0,1fr)]">
            <nav
              aria-label={t("Crew work")}
              className="flex min-w-0 flex-col border-b border-(--ui-tone-neutral-border) @min-[640px]/crew-management:border-b-0 @min-[640px]/crew-management:border-e"
            >
              <div className="px-3 pb-2 pt-3">
                <SegmentedControl
                  label={t("Crew work view")}
                  value={selectedView}
                  options={[
                    {
                      value: "ongoing",
                      label: t("Ongoing ({p0})", {
                        p0: all.filter((run) => run.status !== "finished").length,
                      }),
                    },
                    { value: "finished", label: t("Finished") },
                  ]}
                  onValueChange={(value) => {
                    if (pendingGate.current) return;
                    setView(value === "finished" ? "finished" : "ongoing");
                    setSelectedId("");
                    setError("");
                  }}
                />
              </div>
              <div
                className="max-h-40 overflow-y-auto px-2 pb-2 @min-[640px]/crew-management:max-h-[55vh]"
                role="list"
                aria-label={t("Work list")}
              >
                {listed.map((run) => (
                  <div key={run.id} role="listitem">
                    <Button
                      variant="item"
                      data-crew-work-choice={run.id}
                      selected={selected?.id === run.id}
                      motion="none"
                      className="w-full min-w-0"
                      aria-pressed={selected?.id === run.id}
                      disabled={pending}
                      onClick={() => {
                        setSelectedId(run.id);
                        setError("");
                      }}
                      title={crewRunTitle(run)}
                    >
                      <span className="min-w-0 flex-1 text-start">
                        <span className="block line-clamp-2 break-words font-medium">
                          {crewRunTitle(run)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-(--ui-text-secondary)">
                          <span>{runStatus(run)}</span>
                          <span className="tabular-nums">{progressLabel(run)}</span>
                        </span>
                      </span>
                    </Button>
                  </div>
                ))}
                {!listed.length ? (
                  <p className="px-2 py-3 text-ui-caption text-(--ui-text-secondary)">
                    {view === "ongoing" ? t("No ongoing crew work.") : t("No finished crew work.")}
                  </p>
                ) : null}
              </div>
            </nav>
            <div className="min-w-0 p-4 @min-[640px]/crew-management:min-h-64">
              {error ? <Alert tone="danger">{error}</Alert> : null}
              {data.catalogError ? (
                <Alert tone="warning">
                  {data.catalogError}
                  <Button variant="ghost" onClick={() => void state.refetch()}>
                    {t("Retry")}
                  </Button>
                </Alert>
              ) : null}
              {state.error ? (
                <Alert tone="warning">
                  {state.error.message}
                  <Button variant="ghost" onClick={() => void state.refetch()}>
                    {t("Retry")}
                  </Button>
                </Alert>
              ) : null}
              {selected ? (
                <CrewWorkDetail
                  key={selected.id}
                  run={selected}
                  pending={pending}
                  pendingAction={pendingAction}
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
                  catalogName={(harness, model) =>
                    data.catalog.models[harness as keyof typeof data.catalog.models]?.find(
                      (item) => item.id === model,
                    )?.name ?? model
                  }
                />
              ) : (
                <div className="flex min-h-40 flex-col items-start justify-center gap-3">
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

function CrewWorkDetail({
  run,
  pending,
  pendingAction,
  canOpen,
  onOpen,
  onPause,
  onStop,
  onDelete,
  canDelete,
  catalogName,
}: {
  run: CrewRunView;
  pending: boolean;
  pendingAction: string | null;
  canOpen: boolean;
  onOpen: (id: string, source?: string) => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
  canDelete: boolean;
  catalogName: (harness: string, model: string) => string;
}) {
  const { confirm, dialog } = useConfirm();
  const title = crewRunTitle(run);
  const requests = run.messages.filter((message) => !message.resolvedAt);
  const blocked = run.tasks.filter((task) => task.status === "blocked");
  const running = crewHasRunningWork(run);
  const canStop = crewCanStop(run);
  const request = run.launch?.prompt?.trim();
  const canRemove =
    run.status !== "active" &&
    crewActivityKnown(run) &&
    !running &&
    !run.tasks.some((task) => task.status === "queued");
  return (
    <section data-crew-run={run.id} aria-label={title} className="min-w-0">
      <h3 className="break-words text-ui-title font-medium text-content [overflow-wrap:anywhere]">
        {title}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(run)}>{runStatus(run)}</Badge>
        <span className="text-ui-caption tabular-nums text-(--ui-text-secondary)">
          {progressLabel(run)}
        </span>
      </div>
      {run.status === "paused" && crewActivityKnown(run) ? (
        <p role="status" className="mt-2 text-ui-caption text-(--ui-text-secondary)">
          {running
            ? t("New assignments are paused. Running work can still finish.")
            : t("Work is paused. Nothing is running.")}
        </p>
      ) : null}
      {request && request !== title ? (
        <details className="mt-3 text-ui-caption text-(--ui-text-secondary)">
          <summary className="cursor-pointer">{t("Work request")}</summary>
          <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{request}</p>
        </details>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-(--ui-tone-neutral-border) pb-3">
        {run.status !== "finished" ? (
          <>
            <Button
              variant={run.status === "paused" ? "primary" : "secondary"}
              size="sm"
              disabled={pending}
              loading={pendingAction === `pause:${run.id}`}
              label={run.status === "paused" ? t("Resume work") : t("Pause new assignments")}
              startIcon={
                run.status === "paused" ? (
                  <Play className="icon-sm" />
                ) : (
                  <Pause className="icon-sm" />
                )
              }
              onClick={onPause}
            >
              {run.status === "paused" ? t("Resume work") : t("Pause")}
            </Button>
            {canStop ? (
              <Button
                variant="ghost"
                tone="danger"
                size="sm"
                disabled={pending}
                loading={pendingAction === `stop:${run.id}`}
                startIcon={<Square className="icon-sm" />}
                tooltip={t("Stop work and cancel running assignments")}
                onClick={() =>
                  void confirm({
                    title: t("Stop work"),
                    message: `${title}\n${t("Stop work and cancel running assignments")}`,
                    confirmLabel: t("Stop work"),
                  }).then((ok) => {
                    if (ok) onStop();
                  })
                }
              >
                {t("Stop work")}
              </Button>
            ) : null}
          </>
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || !canRemove}
            loading={pendingAction === `delete:${run.id}`}
            className="ms-auto"
            startIcon={<Trash2 className="icon-sm" />}
            tooltip={!canRemove ? t("Stop work before deleting it.") : t("Delete work")}
            onClick={() =>
              void confirm({
                title: t("Delete work"),
                message: `${title}\n${t("Remove this work from the list? The crew, tasks and conversations are kept.")}`,
                confirmLabel: t("Delete work"),
              }).then((ok) => {
                if (ok) onDelete();
              })
            }
          >
            {t("Delete work")}
          </Button>
        ) : null}
      </div>
      {requests.length || blocked.length || run.error ? (
        <div className="flex flex-col gap-2 pt-3">
          {requests.map((request) => (
            <Alert key={request.id} tone="warning">
              <p className="whitespace-pre-wrap break-words">
                {t("Needs decision: {p0}", { p0: request.text })}
              </p>
              <Button
                variant="link"
                disabled={!run.coordinatorSessionId || !canOpen || pending}
                loading={pendingAction === `open:answer:${request.id}`}
                onClick={() =>
                  run.coordinatorSessionId &&
                  onOpen(run.coordinatorSessionId, `answer:${request.id}`)
                }
              >
                {t("Answer")}
              </Button>
            </Alert>
          ))}
          {blocked.map((task) => (
            <Alert key={task.id} tone="danger">
              <p className="whitespace-pre-wrap break-words">
                {t("Blocked: {p0}", { p0: task.error ?? task.title })}
              </p>
            </Alert>
          ))}
          {run.error ? <Alert tone="warning">{run.error}</Alert> : null}
        </div>
      ) : null}
      <h4 className="pb-2 pt-4 text-ui-caption font-medium text-(--ui-text-secondary)">
        {t("Sessions ({p0})", { p0: sessionCount(run) })}
      </h4>
      <div
        role="list"
        aria-label={t("Sessions")}
        className="flex min-w-0 flex-col divide-y divide-(--ui-tone-neutral-border)"
      >
        <div role="listitem">
          <Button
            variant="item"
            motion="none"
            className="w-full min-w-0"
            disabled={!run.coordinatorSessionId || !canOpen || pending}
            loading={pendingAction === "open:coordinator"}
            onClick={() =>
              run.coordinatorSessionId && onOpen(run.coordinatorSessionId, "coordinator")
            }
          >
            <Bot className="icon-md shrink-0" />
            <span className="min-w-0 flex-1 text-start">
              <span className="block font-medium">{t("Coordinator")}</span>
              <span className="block text-ui-caption text-(--ui-text-secondary)">
                {!run.coordinatorSessionId
                  ? t("Session unavailable")
                  : run.coordinatorStatus === "running"
                    ? t("Working")
                    : run.coordinatorStatus === "interrupted"
                      ? t("Interrupted")
                      : run.status === "paused" && run.coordinatorStatus === "idle"
                        ? t("Nothing running")
                        : t("Conversation")}
              </span>
            </span>
            <ChevronRight className="icon-sm shrink-0" />
          </Button>
        </div>
        {run.tasks.map((task) => {
          const assignment = run.assignments.find((item) => item.taskId === task.id);
          const agent = run.definition.agents.find((item) => item.id === assignment?.memberId);
          const ids = taskSessionIds(task);
          return (
            <div key={task.id} role="listitem" className="min-w-0 py-1">
              <Button
                variant="item"
                motion="none"
                className="w-full min-w-0"
                disabled={!ids.worker || !canOpen || pending}
                loading={pendingAction === `open:worker:${task.id}`}
                onClick={() => ids.worker && onOpen(ids.worker, `worker:${task.id}`)}
                title={`${task.title}\n${task.harness} · ${task.model}\n${assignment?.reason ?? ""}`}
              >
                <CodeBlock className="icon-md shrink-0" />
                <span className="min-w-0 flex-1 text-start">
                  <span className="block truncate font-medium">
                    {agent?.name ?? t("Specialist")}
                  </span>
                  <span className="block truncate text-ui-caption text-(--ui-text-secondary)">
                    {task.title}
                  </span>
                  <span className="block truncate text-ui-caption text-(--ui-text-secondary)">
                    {catalogName(task.harness, task.model)}
                  </span>
                </span>
                <span className="max-w-[38%] text-end text-ui-caption text-(--ui-text-secondary)">
                  {taskStatusLabel(task.status)}
                </span>
                <ChevronRight className="icon-sm shrink-0" />
              </Button>
              {ids.review ? (
                <Button
                  variant="item"
                  motion="none"
                  className="w-full min-w-0"
                  disabled={!canOpen || pending}
                  loading={pendingAction === `open:review:${task.id}`}
                  onClick={() => onOpen(ids.review!, `review:${task.id}`)}
                  title={task.title}
                >
                  <Shield className="icon-md shrink-0" />
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block font-medium">{t("Reviewer")}</span>
                    <span className="block truncate text-ui-caption text-(--ui-text-secondary)">
                      {task.title}
                    </span>
                  </span>
                  <span className="text-ui-caption text-(--ui-text-secondary)">
                    {task.status === "verifying"
                      ? t("Reviewing")
                      : task.verification?.review?.verdict === "pass"
                        ? t("Passed")
                        : task.verification?.review?.verdict === "fail"
                          ? t("Changes needed")
                          : t("Reviewing")}
                  </span>
                  <ChevronRight className="icon-sm shrink-0" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {dialog}
    </section>
  );
}
