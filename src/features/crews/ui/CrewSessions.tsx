import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Pause, Play, Bot, Plus, Square } from "../../../shared/ui/icons";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews } from "../model/crewClient";
import { CrewEditDialog, StartCrewDialog } from "./CrewDialogs";
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
  const [dialog, setDialog] = useState<{ start: true } | { editId?: string } | null>(null);
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
  const runs =
    data?.runs.filter(
      (run) =>
        !query.trim() ||
        `${run.definition.name} ${run.assignments.map((a) => a.title).join(" ")} ${run.definition.agents.map((a) => a.name).join(" ")}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  // Crews are listed and edited in the project rail; this pane shows their runs
  // and keeps Start reachable while the rail is hidden.
  if (!data && !state.error) return null;
  return (
    <section
      aria-label={t("Crews")}
      className="flex flex-col gap-1 border-b border-(--ui-tone-neutral-border) px-2 py-2"
    >
      <div className="flex items-center gap-1">
        <Bot className="size-3.5" aria-hidden />
        <span className="min-w-0 flex-1 text-xs">{t("Crew runs")}</span>
        <Button
          variant="ghost"
          iconOnly
          label={t("Start crew")}
          disabled={!data || pending}
          onClick={() => setDialog(data?.definitions.length ? { start: true } : {})}
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
      {runs.map((run) => {
        const working =
          run.tasks.filter((task) => task.status === "running" || task.status === "verifying")
            .length + (run.coordinatorStatus === "running" ? 1 : 0);
        const blocked = run.tasks.filter((task) => task.status === "blocked").length;
        const requests = run.messages.filter((m) => !m.resolvedAt);
        const stateLabel =
          run.status === "finished"
            ? "Done"
            : run.status === "paused"
              ? "Paused"
              : requests.length
                ? "Needs decision"
                : blocked
                  ? "Blocked"
                  : run.tasks.some((task) => task.status === "review")
                    ? "Awaiting acceptance"
                    : run.tasks.some((task) => task.status === "queued")
                      ? "Queued"
                      : working
                        ? "Working"
                        : "Idle";
        return (
          <div
            key={run.id}
            data-crew-run={run.id}
            className="min-w-0 overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface)"
          >
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1 p-2">
                <span className="min-w-0 flex-1 text-start">
                  <span className="block truncate text-sm font-medium">{run.definition.name}</span>
                  <span className="block text-xs text-(--ui-text-secondary)">
                    {t(stateLabel)}
                    {working > 0 ? ` · ${working} ${t("working")}` : ""}
                  </span>
                </span>
              </div>
              {run.status !== "finished" && (
                <Button
                  variant="ghost"
                  iconOnly
                  label={t(run.status === "paused" ? "Resume crew" : "Pause new crew work")}
                  disabled={pending}
                  onClick={() =>
                    void act(() =>
                      state.call(run.status === "paused" ? "crews.resume" : "crews.pause", {
                        runId: run.id,
                      }),
                    )
                  }
                >
                  {run.status === "paused" ? (
                    <Play className="size-3.5" />
                  ) : (
                    <Pause className="size-3.5" />
                  )}
                </Button>
              )}
              {run.status !== "finished" && (
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Stop crew work")}
                  disabled={pending}
                  onClick={() => void act(() => state.call("crews.stop", { runId: run.id }))}
                >
                  <Square className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-1 border-t border-(--ui-tone-neutral-border) p-1">
              <Button
                variant="item"
                motion="none"
                disabled={!run.coordinatorSessionId || !onOpen || pending}
                onClick={() => run.coordinatorSessionId && open(run.coordinatorSessionId)}
              >
                <Bot className="size-4 shrink-0 text-(--ui-text-secondary)" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{t("Coordinator")}</span>
                <span className="text-xs">
                  {t(
                    run.coordinatorStatus === "running"
                      ? "Working"
                      : run.coordinatorStatus === "interrupted"
                        ? "Interrupted"
                        : "Conversation",
                  )}
                </span>
              </Button>
              {run.tasks.map((task) => {
                const assignment = run.assignments.find((a) => a.taskId === task.id);
                const agent = run.definition.agents.find((a) => a.id === assignment?.memberId);
                const ids = taskSessionIds(task);
                return (
                  <div key={task.id}>
                    <Button
                      variant="item"
                      motion="none"
                      className="w-full"
                      disabled={!ids.worker || !onOpen || pending}
                      title={`${task.title}\n${task.harness} · ${task.model}\n${assignment?.reason ?? ""}\n${task.error ?? ""}`}
                      onClick={() => ids.worker && open(ids.worker)}
                    >
                      <span className="min-w-0 flex-1 text-start">
                        <span className="block truncate">{agent?.name ?? task.title}</span>
                        <span className="block truncate text-xs text-(--ui-text-secondary)">
                          {task.title}
                        </span>
                      </span>
                      <span className="max-w-[42%] shrink-0 text-end text-xs text-(--ui-text-secondary)">
                        {t(
                          task.status === "verifying"
                            ? "Reviewing"
                            : task.status === "review"
                              ? "Awaiting acceptance"
                              : task.status === "blocked"
                                ? "Blocked"
                                : task.status === "done"
                                  ? "Done"
                                  : task.status === "queued"
                                    ? "Queued"
                                    : "Working",
                        )}
                        <span className="block truncate" title={`${task.harness} · ${task.model}`}>
                          {data?.catalog.models[task.harness]?.find((m) => m.id === task.model)
                            ?.name ?? task.model}
                        </span>
                      </span>
                    </Button>
                    {ids.review && (
                      <Button
                        variant="item"
                        motion="none"
                        className="w-full"
                        disabled={!onOpen || pending}
                        onClick={() => open(ids.review!)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {t("Reviewer")} · {task.title}
                        </span>
                        <span className="text-xs">
                          {t(
                            task.verification?.review?.verdict === "pass"
                              ? "Passed"
                              : task.verification?.review?.verdict === "fail"
                                ? "Changes needed"
                                : "Reviewing",
                          )}
                        </span>
                      </Button>
                    )}
                  </div>
                );
              })}
              {requests.length > 0 && (
                <Button
                  variant="secondary"
                  className="mx-1 justify-start"
                  disabled={!run.coordinatorSessionId || !onOpen || pending}
                  title={requests.map((request) => request.text).join("\n")}
                  onClick={() => run.coordinatorSessionId && open(run.coordinatorSessionId)}
                >
                  {t("{p0} requests · Open coordinator", {
                    p0: requests.length,
                  })}
                </Button>
              )}
              {blocked > 0 && (
                <span role="status" className="px-2 text-xs text-(--ui-text-secondary)">
                  {t("{p0} blocked", { p0: blocked })}
                </span>
              )}
              {run.error && <Alert tone="warning">{run.error}</Alert>}
            </div>
          </div>
        );
      })}
      {dialog && "start" in dialog ? (
        <StartCrewDialog
          cwd={cwd}
          state={state}
          onOpen={onOpen}
          onEdit={(editId) => setDialog({ editId })}
          onClose={() => setDialog(null)}
        />
      ) : dialog ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.editId}
          createScope={dialog.editId ? undefined : "project"}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
