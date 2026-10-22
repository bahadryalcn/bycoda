import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { ChevronDown, ChevronRight, Pause, Play, Plus, Square } from "../../../shared/ui/icons";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews, type CrewRunView } from "../model/crewClient";
import { crewRunTitle } from "../model/crewRoster";
import { CrewEditDialog, StartCrewDialog } from "./CrewDialogs";
import { crewWorkStatus, crewWorkStatusLabel } from "./CrewRailSection";

export function CrewSidebar({
  cwd,
  onManagedChange,
  ...props
}: {
  cwd: string;
  query?: string;
  onOpen: (target: BackgroundSessionTarget) => void | Promise<void>;
  onManagedChange: (cwd: string, ids: string[]) => void;
}) {
  const state = useProjectCrews(cwd);
  useEffect(() => {
    if (!state.data) return;
    // Crew conversations are reached from their work, not the plain session list.
    const ids = state.data.runs
      .flatMap((run) => [
        run.coordinatorSessionId,
        ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
      ])
      .filter((id): id is string => !!id);
    onManagedChange(cwd, ids);
  }, [cwd, state.data, onManagedChange]);
  return <CrewSessions cwd={cwd} state={state} {...props} />;
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
            : t("Working");
}

/**
 * Crew work: each delivery given to a crew, with its status and task progress.
 * A row opens the coordinator; details list the members' and reviewers' conversations.
 */
export function CrewSessions({
  cwd,
  state,
  query = "",
  onOpen,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  query?: string;
  onOpen?: (target: BackgroundSessionTarget) => void | Promise<void>;
}) {
  useLocale();
  const [pending, setPending] = useState(false);
  const pendingGate = useRef(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"ongoing" | "finished">("ongoing");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<
    { kind: "start" } | { kind: "edit"; crewId?: string; returnToStart?: boolean } | null
  >(null);
  const data = state.data;
  const act = async (operation: () => Promise<unknown>) => {
    if (pendingGate.current) return;
    pendingGate.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPending(false);
    }
  };
  const open = (sessionId: string) => {
    if (!data || !onOpen) return;
    void act(async () =>
      onOpen({
        cwd,
        machineId: data.machine.id,
        projectId: data.project.id,
        sessionId,
      }),
    );
  };
  const q = query.trim().toLocaleLowerCase();
  const all = [...(data?.runs ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const ongoing = all.filter((run) => run.status !== "finished");
  const finished = all.filter((run) => run.status === "finished");
  const listed = (view === "ongoing" ? ongoing : finished).filter(
    (run) =>
      !q ||
      `${crewRunTitle(run)} ${run.definition.name} ${run.assignments.map((a) => a.title).join(" ")} ${run.definition.agents.map((a) => a.name).join(" ")}`
        .toLocaleLowerCase()
        .includes(q),
  );
  // Crews are listed and edited in the project rail; this pane shows their work
  // and keeps Start reachable while the rail is hidden.
  if (!data && !state.error) return null;
  if (data && !all.length && !data.definitions.length) return null;
  return (
    <section
      aria-label={t("Crew work")}
      className="flex flex-col gap-1.5 border-b border-(--ui-tone-neutral-border) px-2 py-2"
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-(--ui-text-secondary)">
          {t("Crew work")}
        </span>
        {finished.length ? (
          <SegmentedControl
            label={t("Crew work view")}
            value={view}
            options={[
              {
                value: "ongoing",
                label: t("Ongoing ({p0})", { p0: ongoing.length }),
              },
              { value: "finished", label: t("Finished") },
            ]}
            onValueChange={(value) => setView(value === "finished" ? "finished" : "ongoing")}
          />
        ) : null}
        <Button
          variant="ghost"
          iconOnly
          label={t("Start crew work")}
          disabled={!data || pending}
          onClick={() => setDialog(data?.definitions.length ? { kind: "start" } : { kind: "edit" })}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {state.error && (
        <Button variant="ghost" onClick={() => void state.refetch()} title={state.error.message}>
          {t("Crew host unavailable. Retry")}
        </Button>
      )}
      {data && !listed.length ? (
        <p className="px-1 text-xs text-(--ui-text-secondary)">
          {q
            ? t("No matching crew work.")
            : view === "ongoing"
              ? t("No ongoing crew work.")
              : t("No finished crew work.")}
        </p>
      ) : null}
      {listed.map((run) => (
        <CrewWorkRow
          key={run.id}
          run={run}
          catalogName={(harness, model) =>
            data?.catalog.models[harness as keyof typeof data.catalog.models]?.find(
              (m) => m.id === model,
            )?.name ?? model
          }
          expanded={!!expanded[run.id]}
          onToggle={() =>
            setExpanded((current) => ({
              ...current,
              [run.id]: !current[run.id],
            }))
          }
          pending={pending}
          canOpen={!!onOpen}
          onOpen={open}
          onPause={() =>
            void act(() =>
              state.call(run.status === "paused" ? "crews.resume" : "crews.pause", {
                runId: run.id,
              }),
            )
          }
          onStop={() => void act(() => state.call("crews.stop", { runId: run.id }))}
        />
      ))}
      {dialog?.kind === "start" ? (
        <StartCrewDialog
          cwd={cwd}
          state={state}
          onOpen={onOpen}
          onEdit={(crewId) => setDialog({ kind: "edit", crewId, returnToStart: true })}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "edit" ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.crewId}
          createScope={dialog.crewId ? undefined : "project"}
          onStart={() => setDialog({ kind: "start" })}
          onClose={() => setDialog(dialog.returnToStart ? { kind: "start" } : null)}
        />
      ) : null}
    </section>
  );
}

function CrewWorkRow({
  run,
  catalogName,
  expanded,
  onToggle,
  pending,
  canOpen,
  onOpen,
  onPause,
  onStop,
}: {
  run: CrewRunView;
  catalogName: (harness: string, model: string) => string;
  expanded: boolean;
  onToggle: () => void;
  pending: boolean;
  canOpen: boolean;
  onOpen: (sessionId: string) => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const title = crewRunTitle(run);
  const done = run.tasks.filter((task) => task.status === "done").length;
  const requests = run.messages.filter((m) => !m.resolvedAt);
  const blocked = run.tasks.filter((task) => task.status === "blocked");
  const status = run.status === "finished" ? t("Done") : crewWorkStatusLabel(crewWorkStatus(run));
  const progress = run.tasks.length
    ? t("{p0}/{p1} tasks", { p0: done, p1: run.tasks.length })
    : t("Planning");
  return (
    <div
      data-crew-run={run.id}
      className="group min-w-0 overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface)"
    >
      <div className="flex min-w-0 items-center">
        <Button
          variant="item"
          motion="none"
          className="min-w-0 flex-1"
          disabled={!run.coordinatorSessionId || !canOpen || pending}
          title={`${title}\n${run.definition.name}`}
          onClick={() => run.coordinatorSessionId && onOpen(run.coordinatorSessionId)}
        >
          <span className="min-w-0 flex-1 text-start">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="block truncate text-xs text-(--ui-text-secondary)">
              {[run.definition.name, status, progress].join(" · ")}
            </span>
          </span>
        </Button>
        {run.status !== "finished" ? (
          <>
            <Button
              variant="ghost"
              iconOnly
              size="sm"
              label={run.status === "paused" ? t("Resume work") : t("Pause new assignments")}
              disabled={pending}
              onClick={onPause}
            >
              {run.status === "paused" ? (
                <Play className="size-3.5" />
              ) : (
                <Pause className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              iconOnly
              size="sm"
              label={t("Stop work")}
              tooltip={t("Stop work and cancel running assignments")}
              disabled={pending}
              onClick={onStop}
            >
              <Square className="size-3.5" />
            </Button>
          </>
        ) : null}
        <Button
          variant="ghost"
          iconOnly
          size="sm"
          label={expanded ? t("Hide details") : t("Show details")}
          aria-expanded={expanded}
          className="me-1"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>
      </div>
      {requests.length ? (
        <div className="flex min-w-0 items-center gap-2 border-t border-(--ui-tone-neutral-border) px-2 py-1">
          <span
            className="min-w-0 flex-1 truncate text-xs text-warning"
            title={requests.map((r) => r.text).join("\n")}
          >
            {t("Needs decision: {p0}", { p0: requests[0].text })}
          </span>
          <Button
            variant="link"
            size="sm"
            disabled={!run.coordinatorSessionId || !canOpen || pending}
            onClick={() => run.coordinatorSessionId && onOpen(run.coordinatorSessionId)}
          >
            {t("Answer")}
          </Button>
        </div>
      ) : blocked.length ? (
        <p className="truncate border-t border-(--ui-tone-neutral-border) px-2 py-1 text-xs text-danger">
          {t("Blocked: {p0}", { p0: blocked[0].error ?? blocked[0].title })}
        </p>
      ) : null}
      {run.error ? (
        <div className="px-2 pb-2">
          <Alert tone="warning">{run.error}</Alert>
        </div>
      ) : null}
      {expanded ? (
        <div className="flex flex-col gap-px border-t border-(--ui-tone-neutral-border) p-1">
          <div className="flex min-w-0 flex-col gap-1 px-2 py-1 text-xs">
            <p className="break-words font-medium">{title}</p>
            <p className="break-words text-(--ui-text-secondary)">
              {[run.definition.name, status, progress].join(" · ")}
            </p>
            {requests.map((request) => (
              <p key={request.id} className="whitespace-pre-wrap break-words text-warning">
                {t("Needs decision: {p0}", { p0: request.text })}
              </p>
            ))}
            {blocked.map((task) => (
              <p key={task.id} className="whitespace-pre-wrap break-words text-danger">
                {t("Blocked: {p0}", { p0: task.error ?? task.title })}
              </p>
            ))}
          </div>
          <Button
            variant="item"
            motion="none"
            disabled={!run.coordinatorSessionId || !canOpen || pending}
            onClick={() => run.coordinatorSessionId && onOpen(run.coordinatorSessionId)}
          >
            <span className="min-w-0 flex-1 truncate text-start font-medium">
              {t("Coordinator")}
            </span>
            <span className="text-xs text-(--ui-text-secondary)">
              {run.coordinatorStatus === "running"
                ? t("Working")
                : run.coordinatorStatus === "interrupted"
                  ? t("Interrupted")
                  : t("Conversation")}
            </span>
          </Button>
          {run.tasks.map((task) => {
            const assignment = run.assignments.find((a) => a.taskId === task.id);
            const agent = run.definition.agents.find((a) => a.id === assignment?.memberId);
            const ids = taskSessionIds(task);
            return (
              <div key={task.id} className="flex flex-col gap-px">
                <Button
                  variant="item"
                  motion="none"
                  className="w-full"
                  disabled={!ids.worker || !canOpen || pending}
                  title={`${task.title}\n${task.harness} · ${task.model}\n${assignment?.reason ?? ""}\n${task.error ?? ""}`}
                  onClick={() => ids.worker && onOpen(ids.worker)}
                >
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block truncate">{agent?.name ?? task.title}</span>
                    <span className="block truncate text-xs text-(--ui-text-secondary)">
                      {task.title}
                    </span>
                  </span>
                  <span className="max-w-[42%] shrink-0 text-end text-xs text-(--ui-text-secondary)">
                    {taskStatusLabel(task.status)}
                    <span className="block truncate">{catalogName(task.harness, task.model)}</span>
                  </span>
                </Button>
                {ids.review ? (
                  <Button
                    variant="item"
                    motion="none"
                    className="w-full"
                    disabled={!canOpen || pending}
                    onClick={() => onOpen(ids.review!)}
                  >
                    <span className="min-w-0 flex-1 truncate text-start">
                      {t("Reviewer")} · {task.title}
                    </span>
                    <span className="text-xs text-(--ui-text-secondary)">
                      {task.verification?.review?.verdict === "pass"
                        ? t("Passed")
                        : task.verification?.review?.verdict === "fail"
                          ? t("Changes needed")
                          : t("Reviewing")}
                    </span>
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
