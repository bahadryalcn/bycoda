import { Button } from "../../../shared/ui/Button";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useEffect, useRef, useState } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { Shimmer } from "../../../shared/ui/Shimmer";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { HarnessIcon } from "./HarnessIcon";
import { useHoverCard } from "../../../shared/ui/HoverCard";
import { Popover } from "../../../shared/ui/Popover";
import {
  Check,
  Info,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Square,
  X,
} from "../../../shared/ui/icons";
import { useActivityDock, useDockCountLabel, useStopAllControl } from "../model/reactiveReads";
import {
  dockCountParts,
  type ActivityDock as ActivityDockModel,
  type DockAgent,
} from "../model/activityDock";
import { canStopAgent } from "../model/backgroundStop";
import { hasPendingApproval, type Block, type HarnessId } from "../model/session";
import { executionUserIndex } from "../model/executionTurn";
import { turnClockOrigin, useTurnClockInTranscript } from "../model/turnActivity";
import { AgentClock } from "./AgentClock";
import { SubagentStatusSummary } from "./SubagentAnatomy";
import { formatElapsed, useElapsedFrom } from "./useElapsedFrom";
import { STOP_ALL, useStopRequests } from "./useStopRequests";
import { PacingUncle } from "./PacingUncle";
import "./chat-controls.css";

/** Expanded or not, per session, for as long as the app is open. */
const expandedBySession = new Map<string, boolean>();

type Props = {
  sessionId: string;
  harness?: HarnessId;
  blocks: Block[];
  busy: boolean;
  pendingQuestion: boolean;
  /** A visible question form already owns its status; keep only additional activity here. */
  questionPresented?: boolean;
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
  harness,
  blocks,
  busy,
  pendingQuestion,
  questionPresented = false,
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
  // The transcript's activity line shows the same clock while the turn has
  // nothing else to show; with the reader at the end it is on screen, so the
  // dock keeps its state, controls and figure but leaves the number out.
  const clockInTranscript = useTurnClockInTranscript(sessionId) && visible && atEnd;
  const clockOrigin = busy ? turnClockOrigin(blocks[executionUserIndex(blocks)]) : undefined;
  const questionOnlyNotice =
    questionPresented &&
    pendingQuestion &&
    dock.state === "needs-input" &&
    !hasPendingApproval(blocks) &&
    dock.agents.length === 0 &&
    dock.backgroundCount === 0 &&
    !backgroundAgents;

  return (
    <div ref={root}>
      {/* Always mounted, so a state change is announced rather than the dock
          appearing. The ticking clock stays out of it. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {questionOnlyNotice ? "" : displayLabel}
      </span>
      {dock.state === "idle" || questionOnlyNotice ? null : (
        <DockBody
          key={dock.state === "done" ? "done" : "live"}
          sessionId={sessionId}
          harness={harness}
          dock={dock}
          visible={visible}
          label={displayLabel}
          clockOrigin={clockOrigin ?? dock.startedAt}
          clockInTranscript={clockInTranscript}
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
  harness,
  dock,
  visible,
  label,
  clockOrigin,
  clockInTranscript,
  onOpenAgent,
  stop,
}: {
  sessionId: string;
  harness?: HarnessId;
  dock: ActivityDockModel;
  visible: boolean;
  label: string;
  clockOrigin?: number;
  clockInTranscript: boolean;
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
  const clock = (dock.state === "working" || dock.state === "waiting") && !clockInTranscript;
  const stopAllWhenWired = useStopAllControl(dock, stop.perItem);
  const stopAll = stop.onAll ? stopAllWhenWired : null;

  return (
    <section
      aria-label={t("Turn activity")}
      data-activity-dock={dock.state}
      className={`activity-dock mb-1.5 overflow-hidden rounded-lg font-sans text-ui-caption ${
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
            {clock ? <DockClock startedAt={clockOrigin} /> : null}
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
              tooltip={stopAll.title}
              disabled={stop.stopping.has(STOP_ALL)}
              onClick={() => stop.request(STOP_ALL, () => stop.onAll!())}
            >
              <Square className="icon-xs" strokeWidth={1.75} />
              {stop.stopping.has(STOP_ALL)
                ? t("Stopping…")
                : stop.failed.has(STOP_ALL)
                  ? t("Could not stop. Retry")
                  : stopAll.label}
            </Button>
          ) : null}
          {hasAgents ? (
            <>
              <DockAgentInfo dock={dock} />
              <Button
                variant="ghost"
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                data-dock-toggle=""
                aria-label={t(
                  open ? "Background work, {p0}. Hide list" : "Background work, {p0}. Show list",
                  { p0: counts },
                )}
                tooltip={open ? t("Hide background work") : t("Show background work")}
                onClick={() => setExpanded(!open)}
                className="shrink-0"
                iconOnly
              >
                <ChevronUp
                  className={`icon-xs shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
                    open ? "" : "rotate-180"
                  }`}
                  strokeWidth={1.75}
                />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {open ? (
        <div
          id={listId}
          ref={lockList}
          className="activity-dock-list flex max-h-60 flex-col gap-0.5 overflow-x-hidden overflow-y-auto overscroll-none px-1 pb-1"
        >
          {/* Running rows lead, so their Stop buttons are not buried under
              finished ones. The sort is stable: transcript order otherwise. */}
          {[...dock.agents]
            .sort((a, b) => Number(b.status === "running") - Number(a.status === "running"))
            .map((agent) => (
              <DockAgentRow
                key={agent.blockId}
                agent={agent}
                harness={harness}
                onOpen={onOpenAgent}
                stop={stop}
              />
            ))}
        </div>
      ) : null}
    </section>
  );
}

function DockAgentInfo({ dock }: { dock: ActivityDockModel }) {
  const t = useT();
  const [pinned, setPinned] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = t("Background work");
  const hover = useHoverCard({
    side: "top",
    align: "end",
    width: 200,
    disabled: pinned,
    "aria-label": label,
    className: "flex flex-col gap-1 p-3 text-ui-caption",
  });
  const content = dockCountParts(dock).map((part) => (
    <div key={part.text} className="tabular-nums">
      <SubagentStatusSummary parts={[part]} />
    </div>
  ));
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        type="button"
        iconOnly
        label={label}
        tooltip=""
        title=""
        aria-haspopup="dialog"
        aria-expanded={pinned || hover.open}
        {...hover.trigger}
        onClick={() => {
          hover.close();
          setPinned((open) => !open);
        }}
      >
        <Info className="icon-sm" aria-hidden strokeWidth={1.75} />
      </Button>
      {pinned ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          width={200}
          role="dialog"
          aria-label={label}
          autoFocus
          tabIndex={-1}
          onDismiss={() => setPinned(false)}
          className="flex flex-col gap-1 p-3 text-ui-caption"
        >
          {content}
        </Popover>
      ) : (
        hover.card(content)
      )}
    </>
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
        className={`icon-sm shrink-0 ${
          state === "done"
            ? "activity-dock-check text-(--ui-tone-success-fg)"
            : "text-(--ui-tone-success-fg)"
        }`}
        strokeWidth={2}
      />
    );
  }
  if (state === "needs-input") {
    return (
      <CircleAlert className="icon-sm shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={1.75} />
    );
  }
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full bg-(--ui-tone-accent-subtle) ${
        state === "working" ? "" : "activity-dock-waiting"
      }`}
    />
  );
}

function DockAgentRow({
  agent,
  harness,
  onOpen,
  stop,
}: {
  agent: DockAgent;
  harness?: HarnessId;
  onOpen: (agent: DockAgent) => void;
  stop: DockStop;
}) {
  const t = useT();
  const statusWord = {
    running: t("Running"),
    done: t("Done"),
    failed: t("Failed"),
    stopped: t("Stopped by you"),
    interrupted: t("Interrupted"),
  }[agent.status];
  const summary = [agent.name, agent.model, agent.detail, statusWord].filter(Boolean).join(", ");
  const key = agent.callId ?? agent.blockId;
  const stoppable = canStopAgent(agent, stop.perItem);
  const stopping = stop.stopping.has(key);
  return (
    <div className="activity-dock-item flex min-w-0 items-start py-0.5">
      <Button
        variant="item"
        type="button"
        aria-label={t(agent.kind === "agent" ? "Open {p0}" : "Show {p0}", { p0: summary })}
        tooltip={summary}
        data-dock-agent={agent.blockId}
        data-dock-agent-state={agent.status}
        onClick={() => onOpen(agent)}
        className="activity-dock-agent min-w-0 flex-1 items-center text-left"
      >
        <span className="flex shrink-0" aria-hidden="true">
          <AgentStatusDot status={agent.status} />
        </span>
        <span className="activity-dock-agent-identity min-w-0 flex-1">
          {agent.kind === "agent" ? (
            <span className="flex min-w-0 items-center gap-1.5 text-(--ui-text-secondary)">
              {harness ? <HarnessIcon harness={harness} size="xs" className="shrink-0" /> : null}
              <span className="truncate">{agent.model ?? t("Subagent")}</span>
            </span>
          ) : null}
          <span className="line-clamp-2 block whitespace-pre-wrap text-(--ui-tone-neutral-fg) [overflow-wrap:anywhere]">
            {agent.name}
          </span>
        </span>
        <span className="activity-dock-agent-metrics flex shrink-0 flex-wrap items-center justify-end gap-x-2 text-(--ui-text-secondary)">
          {agent.detail ? (
            <span
              className={`min-w-0 ${agent.status === "failed" ? "text-(--ui-tone-danger-fg)" : agent.status === "stopped" || agent.status === "interrupted" ? "text-(--ui-tone-warning-fg)" : ""}`}
            >
              {agent.detailParts ? (
                <SubagentStatusSummary parts={agent.detailParts} />
              ) : (
                agent.detail
              )}
            </span>
          ) : null}
          <AgentClock
            startedAt={agent.startedAt}
            endedAt={agent.endedAt}
            live={agent.status === "running"}
          />
        </span>
        <ChevronRight className="icon-xs shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
      </Button>
      {stoppable ? (
        <Button
          className="mr-1 shrink-0"
          variant="ghost"
          type="button"
          disabled={stopping}
          aria-label={t(stopping ? "Stopping {p0}" : "Stop {p0}", { p0: agent.name })}
          tooltip={
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
          <Square className="icon-xs" strokeWidth={1.75} />
          {stopping
            ? t("Stopping…")
            : stop.failed.has(key)
              ? t("Could not stop. Retry")
              : t("Stop")}
        </Button>
      ) : null}
    </div>
  );
}

function AgentStatusDot({ status }: { status: DockAgent["status"] }) {
  useLocale();
  if (status === "running") return <WorkingIndicator size="xs" />;
  if (status === "done")
    return <Check className="icon-xs shrink-0 text-(--ui-tone-success-fg)" strokeWidth={2} />;
  if (status === "failed") {
    return <X className="icon-xs shrink-0 text-(--ui-tone-danger-fg)" strokeWidth={2} />;
  }
  if (status === "stopped") {
    return <Square className="icon-xs shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={2} />;
  }
  if (status === "interrupted") {
    return <CircleAlert className="icon-xs shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={2} />;
  }
  return null;
}
