import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { findModel } from "../../sessions/model/models";
import { orchestrator } from "../model/orchestration";
import { orchestrationTaskLabel, type OrchestrationSummary } from "../model/orchestrationSummary";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { OrchestrationActions, OrchestrationWorkers } from "./OrchestrationActions";
import { Check, ChevronDown, ChevronRight, CircleAlert } from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";

export function OrchestrationSidebarAgents({
  leadId,
  summary,
}: {
  leadId: string;
  summary: OrchestrationSummary;
}) {
  useLocale();
  const actions = useContext(OrchestrationActions);
  const workers = useContext(OrchestrationWorkers);
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  // Rows expand independently, so several agents can be watched side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Revealing a worker from its toast opens that row without closing others.
  const revealed = workers.selectedId;
  useEffect(() => {
    if (revealed)
      setExpanded((current) => (current.has(revealed) ? current : new Set(current).add(revealed)));
  }, [revealed]);
  const toggle = (sessionId: string, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    if (isOpen && revealed === sessionId) workers.inspect(null);
  };
  // A saved run has no live entry, so the card stays read-only after a reload.
  const run = runs.find((entry) => entry.leadId === leadId);
  const stopping = !!run?.tasks.some(
    (task) => task.status === "running" || task.status === "cancelling",
  );
  const resumeBlocker = run?.status === "paused" ? orchestrator.resumeBlocker(leadId) : undefined;
  const leadBusy = run?.status === "paused" && orchestrator.resumeLeadBusy(leadId);
  const perform = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const done = summary.tasks.filter((task) => task.status === "completed").length;
  // Sits inside an already-lit row, so it needs its own surface to read as a
  // button rather than as another line of text.
  return (
    <div className="relative mt-1.5">
      <div className="mb-0.5 px-0.5 flex items-center justify-between text-[11px] text-(--ui-text-secondary)">
        <span>
          {summary.tasks.length} {summary.tasks.length === 1 ? t("agent") : t("agents")}
        </span>
        <span className="tabular-nums">
          {done}/{summary.tasks.length}
          {t(" done")}
        </span>
      </div>
      {/*
        Offset by the rows' own padding so a chevron lands on the card's
        content edge, under the harness icon of the header above.

        No height cap and no scroller: the card grows with whatever the user
        expanded, and the sidebar it sits in does the only scrolling. Nesting
        a second scroll region here made rows clip mid-line.
      */}
      <div
        aria-label={t("Orchestrated agents")}
        className="-mx-2 flex touch-pan-y flex-col gap-px"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {summary.tasks.map((task) => {
          // Something waiting on an answer opens itself; it cannot be missed.
          const open = expanded.has(task.sessionId) || !!task.needsInput;
          const live = run?.tasks.find((entry) => entry.sessionId === task.sessionId);
          const label = orchestrationTaskLabel(task, summary);
          const working = summary.live && task.status === "running" && !task.needsInput;
          // A saved provider model may not be in this window's catalog yet.
          // Keep its identity instead of substituting the harness default.
          const model = findModel(task.model)?.name ?? task.model;
          return (
            <div
              key={task.sessionId}
              data-orchestration-agent={task.sessionId}
              // Expanding lights the whole row, header and detail together.
              className={`rounded-md ${open ? "bg-selection" : ""}`}
            >
              <Button
                variant="item"
                type="button"
                title={`${task.title} · ${HARNESS_TITLE[task.harness]} · ${model} · ${label}`}
                aria-label={t("Agent details: {p0}", { p0: task.title })}
                fullWidth
                className="group/agent min-w-0"
                selected={open}
                aria-expanded={open}
                onClick={() => toggle(task.sessionId, open)}
                // Named, because the whole session card is already a `group`.
              >
                {/* One slot: the chevron stands in for the harness mark
                    whenever this row is open or under the pointer. */}
                <span className="grid size-3.5 shrink-0 place-items-center text-(--ui-text-secondary)">
                  {open ? (
                    <ChevronDown className="size-3" strokeWidth={1.75} />
                  ) : (
                    <>
                      <HarnessIcon
                        harness={task.harness}
                        className="size-3.5 opacity-75 group-focus-visible/agent:hidden group-hover/agent:hidden"
                      />
                      <ChevronRight
                        className="hidden size-3 group-focus-visible/agent:block group-hover/agent:block"
                        strokeWidth={1.75}
                      />
                    </>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-(--ui-text-secondary)">
                  {task.title}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[11px] ${
                    task.needsInput ||
                    task.status === "failed" ||
                    task.status === "blocked" ||
                    task.status === "interrupted"
                      ? "text-(--ui-tone-warning-fg)"
                      : working
                        ? "text-(--ui-tone-accent-fg)"
                        : task.status === "completed"
                          ? "text-(--ui-tone-success-fg)"
                          : "text-(--ui-text-secondary)"
                  }`}
                >
                  {task.needsInput ||
                  task.status === "failed" ||
                  task.status === "blocked" ||
                  task.status === "interrupted" ? (
                    <CircleAlert className="size-3" strokeWidth={1.75} />
                  ) : working ? (
                    <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-(--ui-tone-accent-fg)" />
                  ) : task.status === "completed" ? (
                    <Check className="size-3" strokeWidth={2.25} />
                  ) : null}
                  <span>{label}</span>
                </span>
              </Button>
              {/* Indented to the title's column: the icon slot and its gap. */}
              {open && (
                <div className="space-y-2 pb-3 pl-6.5 pr-2">
                  <p
                    className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--ui-text-secondary)"
                    title={`${model} · ${HARNESS_TITLE[task.harness]}`}
                  >
                    <HarnessIcon harness={task.harness} className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{model}</span>
                  </p>
                  {live?.error && (
                    <p className="text-[11px] text-(--ui-tone-danger-fg)">{live.error}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {workers.openDetails && (
                      <Button
                        variant="ghost"
                        type="button"
                        title={t("Open this agent beside the orchestrator")}

                        onClick={() =>
                          workers.openDetails?.({
                            sessionId: task.sessionId,
                            leadId,
                            title: task.title,
                            harness: task.harness,
                          })
                        }
                      >
                        {t("See details")}
                      </Button>
                    )}
                    {live && ["queued", "running"].includes(live.status) && (
                      <Button
                        variant="ghost"
                        type="button"

                        disabled={pending}
                        onClick={() => void perform(() => orchestrator.cancelTask(leadId, live.id))}
                      >
                        {t("Cancel task")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(error || run?.error) && (
        <Alert tone="danger" role="alert">
          {error ?? run?.error}
        </Alert>
      )}
      {/* Stopping a run belongs to the composer, which stops the lead and its
          agents together. Resume has no other home, so it stays. */}
      {run?.status === "paused" && (
        <div className="mt-1.5 space-y-1.5 border-t border-(--ui-tone-neutral-border) pt-1.5">
          <p className="px-0.5 text-[11px] leading-relaxed text-(--ui-text-secondary)">
            {stopping
              ? t("Stopping interrupted work before this run can resume.")
              : leadBusy
                ? t("Waiting for the lead's interrupted turn to finish before this run can resume.")
                : t(
                    "Resume continues interrupted workers from their retained checkouts and starts queued work. Policy-blocked tasks stay stopped for review.",
                  )}
          </p>
          {resumeBlocker && (
            <p className="px-0.5 text-[11px] leading-relaxed text-(--ui-tone-warning-fg)">
              {resumeBlocker.title || t("Another conversation")}
              {t(" is still running in this project.")}
            </p>
          )}
          <div className="-mr-1.5 flex items-center justify-end gap-1">
            {resumeBlocker && actions && (
              <Button
                variant="ghost"
                type="button"

                disabled={pending}
                onClick={() => actions.open(resumeBlocker.id)}
              >
                {t("Open blocker")}
              </Button>
            )}
            <Button
              variant="ghost"
              type="button"

              disabled={pending || stopping || leadBusy || !!resumeBlocker}
              title={
                stopping
                  ? t("Wait for interrupted agents to stop")
                  : leadBusy
                    ? t("Wait for the lead's interrupted turn to finish")
                    : resumeBlocker
                      ? t("Stop {p0} before resuming", {
                          p0: resumeBlocker.title || "the other conversation",
                        })
                      : t("Continue interrupted and queued work")
              }
              onClick={() =>
                void perform(() => orchestrator.start(leadId, run.allowedHarnesses, run.maxWorkers))
              }
            >
              {t("Resume")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
