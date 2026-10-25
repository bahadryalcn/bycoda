import { Button } from "../../../shared/ui/Button";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useEffect, useRef, useState } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { Shimmer } from "../../../shared/ui/Shimmer";
import {
  Bot,
  Check,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Square,
  X,
} from "../../../shared/ui/icons";
import { useActivityDock, useDockCountLabel, useStopAllControl } from "../model/reactiveReads";
import { type ActivityDock as ActivityDockModel, type DockAgent } from "../model/activityDock";
import { canStopAgent } from "../model/backgroundStop";
import type { Block } from "../model/session";
import { AgentClock } from "./AgentClock";
import { formatElapsed, useElapsedFrom } from "./useElapsedFrom";
import { STOP_ALL, useStopRequests } from "./useStopRequests";
import { PacingUncle } from "./PacingUncle";
import "./chat-controls.css";

/** Expanded or not, per session, for as long as the app is open. */
const expandedBySession = new Map<string, boolean>();

type Props = {
  sessionId: string;
  blocks: Block[];
  busy: boolean;
  pendingQuestion: boolean;
  /** The previous turn ended, but a queued send still has no delivery acknowledgement. */
  deliveryUnconfirmed?: boolean;
  backgroundTasks?: string[];
  backgroundAgents?: number;
  /** False while another tab is in front; nothing counts as seen then. */
  visible?: boolean;
  /** The transcript is scrolled to its last line. */
  atEnd: boolean;
  /**
   * A row was clicked: open the subagent trail or background command details.
   */
  onOpenAgent: (agent: DockAgent) => void;
  /** The harness can stop one row on its own; otherwise only the whole turn. */
  perItemStop?: boolean;
  /** Stops one running subagent or command (`perItemStop` harnesses only). */
  onStopAgent?: (agent: DockAgent) => Promise<void>;
  /** Stops all background work, or interrupts the turn when it cannot be split. */
  onStopAll?: () => Promise<void>;
};

/**
 * Turn state that stays beside the input. The transcript's own status line and
 * agent rows scroll away with the turn they belong to; this reads the same
 * data (one `deriveActivityDock`) from the one place the reader always is.
 */
export const ActivityDock = memo(function ActivityDock({
  sessionId,
  blocks,
  busy,
  pendingQuestion,
  deliveryUnconfirmed = false,
  backgroundTasks,
  backgroundAgents,
  visible = true,
  atEnd,
  onOpenAgent,
  perItemStop = false,
  onStopAgent,
  onStopAll,
}: Props) {
  useLocale();
  const t = useT();
  const stops = useStopRequests();
  const root = useRef<HTMLDivElement>(null);
  let turnId: string | undefined;
  let turnHasActivity = false;
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index].role === "user") {
      turnId = blocks[index].id;
      turnHasActivity = index < blocks.length - 1;
      break;
    }
  }
  const [completedTurn, setCompletedTurn] = useState<string>();
  const previous = useRef({ busy, turnId, sessionId });

  useEffect(() => {
    const prior = previous.current;
    if (busy || (visible && atEnd) || prior.turnId !== turnId || prior.sessionId !== sessionId) {
      setCompletedTurn(undefined);
    } else if (prior.busy) {
      setCompletedTurn(turnId);
    }
    previous.current = { busy, turnId, sessionId };
  }, [busy, turnId, sessionId, visible, atEnd]);

  useEffect(() => {
    const composer = root.current?.closest("[data-composer]");
    if (!composer) return;
    const acknowledge = () => setCompletedTurn(undefined);
    composer.addEventListener("focusin", acknowledge);
    return () => composer.removeEventListener("focusin", acknowledge);
  }, []);

  const { dock, label } = useActivityDock({
    blocks,
    busy,
    pendingQuestion,
    backgroundTasks,
    backgroundAgents,
    // A new user block may arrive before the provider's busy acknowledgement.
    // Never label that new turn with the previous turn's completion state.
    unseenDone:
      turnHasActivity && !!completedTurn && completedTurn === turnId && !(visible && atEnd),
  });
  const displayLabel =
    dock.state === "done" && deliveryUnconfirmed
      ? `${t("Turn activity")}: ${t("Finished")}`
      : label;

  return (
    <div ref={root}>
      {/* Always mounted, so a state change is announced rather than the dock
          appearing. The ticking clock stays out of it. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {displayLabel}
      </span>
      {dock.state === "idle" ? null : (
        <DockBody
          key={dock.state === "done" ? "done" : "live"}
          sessionId={sessionId}
          dock={dock}
          visible={visible}
          label={displayLabel}
          onOpenAgent={onOpenAgent}
          stop={{
            ...stops,
            perItem: perItemStop && !!onStopAgent,
            onAgent: onStopAgent,
            onAll: onStopAll,
          }}
        />
      )}
    </div>
  );
});

type DockStop = ReturnType<typeof useStopRequests> & {
  perItem: boolean;
  onAgent?: (agent: DockAgent) => Promise<void>;
  onAll?: () => Promise<void>;
};

function DockBody({
  sessionId,
  dock,
  visible,
  label,
  onOpenAgent,
  stop,
}: {
  sessionId: string;
  dock: ActivityDockModel;
  visible: boolean;
  label: string;
  onOpenAgent: (agent: DockAgent) => void;
  stop: DockStop;
}) {
  const t = useT();
  const [expanded, setExpandedState] = useState(() => expandedBySession.get(sessionId) ?? false);
  const lockList = useLockOverscroll<HTMLDivElement>();
  const setExpanded = (next: boolean) => {
    expandedBySession.set(sessionId, next);
    setExpandedState(next);
  };
  const hasAgents = dock.agents.length > 0;
  const open = expanded && hasAgents;
  const listId = `activity-dock-agents-${sessionId}`;
  const counts = useDockCountLabel(dock);
  const clock = dock.state === "working" || dock.state === "waiting";
  const stopAllWhenWired = useStopAllControl(dock, stop.perItem);
  const stopAll = stop.onAll ? stopAllWhenWired : null;

  return (
    <section
      aria-label={t("Turn activity")}
      data-activity-dock={dock.state}
      className={`activity-dock mb-1.5 overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) font-sans text-xs ${
        dock.state === "done" ? "activity-dock-done" : ""
      }`}
    >
      <div className="relative" data-activity-status-row>
        <div className="relative flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
          <div className="activity-dock-summary">
            <DockMark state={dock.state} />
            <span
              className={`min-w-0 truncate ${
                dock.state === "needs-input"
                  ? "text-(--ui-tone-warning-fg)"
                  : dock.state === "done"
                    ? "text-(--ui-tone-success-fg)"
                    : "activity-dock-label"
              }`}
            >
              {dock.state === "working" ? (
                <Shimmer className="truncate" duration={1.6}>
                  {label}
                </Shimmer>
              ) : (
                label
              )}
            </span>
            {clock ? <DockClock startedAt={dock.startedAt} /> : null}
          </div>
          {dock.state === "working" || dock.state === "waiting" ? (
            <div
              data-pacing-track="reserved"
              className="pointer-events-none relative h-8 w-20 shrink-0 overflow-clip"
            >
              <PacingUncle visible={visible} />
            </div>
          ) : null}
          {stopAll ? (
            <Button
              className="shrink-0"
              variant="ghost"
              type="button"
              title={stopAll.title}
              disabled={stop.stopping.has(STOP_ALL)}
              onClick={() => stop.request(STOP_ALL, () => stop.onAll!())}
            >
              <Square className="size-3" strokeWidth={1.75} />
              {stop.stopping.has(STOP_ALL)
                ? t("Stopping…")
                : stop.failed.has(STOP_ALL)
                  ? t("Could not stop. Retry")
                  : stopAll.label}
            </Button>
          ) : null}
          {hasAgents ? (
            <Button
              variant="ghost"
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              aria-label={t(
                open ? "Background agents, {p0}. Hide list" : "Background agents, {p0}. Show list",
                { p0: counts },
              )}
              title={open ? t("Hide agents") : t("Show agents")}
              onClick={() => setExpanded(!open)}
              className="shrink-0"
            >
              <Bot className="size-3" strokeWidth={1.75} />
              <span className="tabular-nums">{counts}</span>
              <ChevronUp
                className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${
                  open ? "" : "rotate-180"
                }`}
                strokeWidth={1.75}
              />
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div
          id={listId}
          ref={lockList}
          className="activity-dock-list flex max-h-60 flex-col overflow-x-hidden overflow-y-auto overscroll-none border-t border-(--ui-tone-neutral-border) px-1"
        >
          {/* Running rows lead, so their Stop buttons are not buried under
              finished ones. The sort is stable: transcript order otherwise. */}
          {[...dock.agents]
            .sort((a, b) => Number(b.status === "running") - Number(a.status === "running"))
            .map((agent) => (
              <DockAgentRow key={agent.blockId} agent={agent} onOpen={onOpenAgent} stop={stop} />
            ))}
        </div>
      ) : null}
    </section>
  );
}

/** Its own component so only the clock re-renders each second. */
function DockClock({ startedAt }: { startedAt?: number }) {
  useLocale();
  const elapsed = formatElapsed(useElapsedFrom(startedAt, false));
  return <span className="activity-dock-clock shrink-0 tabular-nums">{elapsed}</span>;
}

function DockMark({ state }: { state: ActivityDockModel["state"] }) {
  useLocale();
  if (state === "done" || state === "background") {
    return (
      <Check
        className={`size-3.5 shrink-0 ${
          state === "done"
            ? "activity-dock-check text-(--ui-tone-success-fg)"
            : "text-(--ui-tone-success-fg)"
        }`}
        strokeWidth={2.25}
      />
    );
  }
  if (state === "needs-input") {
    return (
      <CircleAlert className="size-3.5 shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={1.75} />
    );
  }
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full bg-(--ui-tone-accent-subtle) ${
        state === "working"
          ? "shadow-[0_0_8px_var(--color-accent)] motion-safe:animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_3]"
          : "activity-dock-waiting"
      }`}
    />
  );
}

function DockAgentRow({
  agent,
  onOpen,
  stop,
}: {
  agent: DockAgent;
  onOpen: (agent: DockAgent) => void;
  stop: DockStop;
}) {
  const t = useT();
  const summary = [agent.name, agent.model, agent.detail, agent.status].filter(Boolean).join(", ");
  const key = agent.callId ?? agent.blockId;
  const stoppable = canStopAgent(agent, stop.perItem);
  const stopping = stop.stopping.has(key);
  return (
    <div className="activity-dock-item flex min-w-0 items-start border-t border-(--ui-tone-neutral-border) py-1 first:border-t-0">
      <Button
        variant="item"
        type="button"
        aria-label={`${agent.kind === "agent" ? "Open" : "Show"} ${summary}`}
        title={agent.name}
        data-dock-agent={agent.blockId}
        onClick={() => onOpen(agent)}
        className="min-w-0 flex-1 items-start text-left"
      >
        <span className="mt-1 flex shrink-0">
          <AgentStatusDot status={agent.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block whitespace-pre-wrap text-(--ui-tone-neutral-fg) [overflow-wrap:anywhere]">
            {agent.name}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-(--ui-text-secondary) [overflow-wrap:anywhere]">
            {agent.model ? <span className="min-w-0">{agent.model}</span> : null}
            {agent.detail ? <span className="min-w-0">{agent.detail}</span> : null}
            <AgentClock
              startedAt={agent.startedAt}
              endedAt={agent.endedAt}
              live={agent.status === "running"}
            />
          </span>
        </span>
        <ChevronRight
          className="mt-1 size-3 shrink-0 text-(--ui-text-secondary)"
          strokeWidth={1.75}
        />
      </Button>
      {stoppable ? (
        <Button
          className="mr-1 shrink-0"
          variant="ghost"
          type="button"
          disabled={stopping}
          aria-label={`${stopping ? "Stopping" : "Stop"} ${agent.name}`}
          title={
            stop.failed.has(key)
              ? t("Could not stop it. Try again.")
              : stopping
                ? t("Stopping…")
                : agent.kind === "agent"
                  ? t("Stop this subagent")
                  : t("Stop this command")
          }
          onClick={() => stop.request(key, () => stop.onAgent!(agent))}
        >
          <Square className="size-3" strokeWidth={1.75} />
          {stopping ? t("Stopping…") : t("Stop")}
        </Button>
      ) : null}
    </div>
  );
}

function AgentStatusDot({ status }: { status: DockAgent["status"] }) {
  useLocale();
  if (status === "failed") {
    return <X className="size-3 shrink-0 text-(--ui-tone-danger-fg)" strokeWidth={2} />;
  }
  if (status === "stopped") {
    return <Square className="size-3 shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={2} />;
  }
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${
        status === "running"
          ? "bg-(--ui-tone-accent-subtle) motion-safe:animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_3]"
          : "bg-(--ui-tone-success-subtle)"
      }`}
    />
  );
}
