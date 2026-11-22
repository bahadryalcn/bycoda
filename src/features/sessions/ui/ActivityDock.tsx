import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { LiveText } from "../../../shared/ui/LiveText";
import { Badge } from "../../../shared/ui/Badge";
import { Divider } from "../../../shared/ui/Divider";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Button } from "../../../shared/ui/Button";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { ClampText } from "../../../shared/ui/ClampText";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { useDelegatedRunDiscovery } from "../../connections/public/delegatedRuns";
import { InlineError } from "../../../shared/ui/InlineError";
import { AccountColorDot } from "../../providers/public/accountIdentity";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";
import { Check, ChevronRight, CircleAlert, Square, X } from "../../../shared/ui/icons";
import { useActivityDock, useDockCountParts, useStopAllControl } from "../model/reactiveReads";
import {
  groupDockAgents,
  type ActivityDock as ActivityDockModel,
  type DockAgent,
} from "../model/activityDock";
import { canStopAgent } from "../model/backgroundStop";
import { hasPendingApproval, type Block, type HarnessId } from "../model/session";
import { executionUserIndex } from "../model/executionTurn";
import { useTurnClockInTranscript, useTurnClockOrigin } from "../model/turnActivity";
import { AgentClock } from "./AgentClock";
import { SubagentStatusSummary } from "./SubagentAnatomy";
import { HarnessIcon } from "./HarnessIcon";
import type { TextTone } from "../../../shared/ui/Text";
import { formatElapsed, useElapsedFrom } from "./useElapsedFrom";
import { STOP_ALL, useStopRequests } from "./useStopRequests";
import { PacingUncle } from "./PacingUncle";
import { DockApprovalActions } from "./ActivityDockApproval";
import "./chat-controls.css";

const expandedBySession = new Map<string, boolean>();
const activeSessions = new Map<string, number>();
function trimExpandedSessions() {
  let retired = [...expandedBySession.keys()].filter((key) => !activeSessions.has(key)).length;
  for (const key of expandedBySession.keys()) {
    if (retired <= 256) break;
    if (activeSessions.has(key)) continue;
    expandedBySession.delete(key);
    retired--;
  }
}

type Props = {
  sessionId: string;
  harness?: HarnessId;
  blocks: Block[];
  busy: boolean;
  pendingQuestion: boolean;
  pendingOwnerApproval?: boolean;
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
  /** Cross-provider children of this session, already mapped to rows. */
  delegatedAgents?: DockAgent[];
  goalControl?: React.ReactNode;
  workControl?: React.ReactNode;
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
  pendingOwnerApproval,
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
  delegatedAgents,
  goalControl,
  workControl,
}: Props) {
  useLocale();
  const t = useT();
  const discovery = useDelegatedRunDiscovery(sessionId, visible);
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
    pendingOwnerApproval,
    backgroundTasks,
    backgroundAgents,
    delegatedAgents,
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
  const clockOrigin = useTurnClockOrigin(busy ? blocks[executionUserIndex(blocks)] : undefined);
  const questionOnlyNotice =
    questionPresented &&
    pendingQuestion &&
    !pendingOwnerApproval &&
    dock.state === "needs-input" &&
    !hasPendingApproval(blocks) &&
    dock.agents.length === 0 &&
    dock.backgroundCount === 0 &&
    !backgroundAgents;

  const statusNotice = (
    <>
      {dock.state === "idle" || questionOnlyNotice ? (
        goalControl ? (
          <div className="flex justify-end px-3">{goalControl}</div>
        ) : null
      ) : (
        <DockBody
          key={dock.state === "done" ? "done" : "live"}
          sessionId={sessionId}
          harness={harness}
          blocks={blocks}
          dock={dock}
          visible={visible}
          label={displayLabel}
          clockOrigin={clockOrigin ?? dock.startedAt}
          clockInTranscript={clockInTranscript}
          onOpenAgent={onOpenAgent}
          goalControl={goalControl}
          stop={{
            ...stops,
            perItem: perItemStop && !!onStopAgent,
            onAgent: onStopAgent,
            onAll: onStopAll,
          }}
        />
      )}
    </>
  );
  return (
    <div ref={root}>
      {discovery.error ? (
        <InlineError retry={{ onRetry: discovery.retry }}>{discovery.error}</InlineError>
      ) : null}
      {/* Always mounted, so a state change is announced rather than the dock
          appearing. The ticking clock stays out of it. */}
      <LiveText className="sr-only" text={questionOnlyNotice ? "" : displayLabel} />
      {workControl ? (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">{statusNotice}</div>
          <div className="flex shrink-0 items-center">{workControl}</div>
        </div>
      ) : (
        statusNotice
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
  blocks,
  dock,
  visible,
  label,
  clockOrigin,
  clockInTranscript,
  onOpenAgent,
  goalControl,
  stop,
}: {
  sessionId: string;
  harness?: HarnessId;
  blocks: Block[];
  dock: ActivityDockModel;
  visible: boolean;
  label: string;
  clockOrigin?: number;
  clockInTranscript: boolean;
  onOpenAgent: (agent: DockAgent) => void;
  goalControl?: React.ReactNode;
  stop: DockStop;
}) {
  const t = useT();
  const [expanded, setExpandedState] = useState(() => expandedBySession.get(sessionId) ?? false);
  useEffect(() => {
    activeSessions.set(sessionId, (activeSessions.get(sessionId) ?? 0) + 1);
    return () => {
      const remaining = (activeSessions.get(sessionId) ?? 1) - 1;
      if (remaining) activeSessions.set(sessionId, remaining);
      else activeSessions.delete(sessionId);
      trimExpandedSessions();
    };
  }, [sessionId]);
  const setExpanded = (next: boolean) => {
    expandedBySession.delete(sessionId);
    expandedBySession.set(sessionId, next);
    setExpandedState(next);
  };
  const lockList = useLockOverscroll<HTMLDivElement>();
  // Children the transcript shows as cards are listed too: the list is the one place that
  // gathers every run, and the composer's subagent control steps aside while it shows.
  const listed = dock.agents;
  const hasAgents = listed.length > 0;
  const open = expanded && hasAgents;
  const listId = `activity-dock-agents-${sessionId}`;
  const counts = useDockCountParts(dock);
  const clock = (dock.state === "working" || dock.state === "waiting") && !clockInTranscript;
  const stopAllWhenWired = useStopAllControl(dock, stop.perItem);
  const stopAll = stop.onAll ? stopAllWhenWired : null;
  const stopAllButton = stopAll ? (
    <Button
      data-dock-stop-all=""
      className="shrink-0"
      variant="ghost"
      type="button"
      tooltip={stop.failed.has(STOP_ALL) ? t("Could not stop it. Try again.") : stopAll.title}
      startIcon={<Square className="icon-xs" strokeWidth={1.75} />}
      reserveLabels={[stopAll.label, t("Stopping…"), t("Retry stop")]}
      disabled={stop.stopping.has(STOP_ALL)}
      onClick={() => stop.request(STOP_ALL, () => stop.onAll!())}
    >
      {stop.stopping.has(STOP_ALL)
        ? t("Stopping…")
        : stop.failed.has(STOP_ALL)
          ? t("Retry stop")
          : stopAll.label}
    </Button>
  ) : null;

  const summary = (
    <span className="activity-dock-summary">
      <DockMark state={dock.state} />
      <Text
        as="span"
        size="inherit"
        tone={
          dock.state === "needs-input" ? "warning" : dock.state === "done" ? "success" : "secondary"
        }
        truncate
      >
        {label}
      </Text>
      {clock ? <DockClock startedAt={clockOrigin} /> : null}
      {/* Inside the summary: a narrow dock gives the summary a full row, and the
            walker must stay on it instead of wrapping below the label. */}
      {dock.state === "working" || dock.state === "waiting" ? (
        <span
          data-pacing-track="reserved"
          className="pointer-events-none relative ms-auto -me-1 block h-8 w-20 shrink-0 overflow-clip"
        >
          <PacingUncle visible={visible} />
        </span>
      ) : null}
    </span>
  );
  // The whole header is the trigger: state, clock and counts open the list together.
  const toggle = (
    // oxlint-disable-next-line bycoda/transcript-row-trigger -- the dock header is composer chrome, not a transcript row
    <Button
      variant="ghost"
      type="button"
      expanded={open}
      opens="up"
      controlHeight="auto"
      padding={{ block: "xs" }}
      aria-controls={listId}
      data-dock-toggle=""
      label={`${label}. ${t(
        open ? "Background work, {p0}. Hide list" : "Background work, {p0}. Show list",
        { p0: counts.map(({ text }) => text).join(" · ") },
      )}`}
      tooltip={open ? t("Hide background work") : t("Show background work")}
      onClick={() => setExpanded(!open)}
      className="max-w-full min-w-0 flex-1 justify-between"
    >
      {/* One wrapping row: a narrow dock drops the counts under the summary instead of squeezing it. */}
      <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {summary}
        {/* The provider marks name who runs the work; the counts say how it stands.
        "Background work" stays in the accessible label only. */}
        <span className="flex min-w-0 shrink-0 items-center gap-2">
          <ProviderStack agents={listed} fallback={harness} />
          <span className="flex min-w-0 flex-wrap items-center gap-x-1">
            {counts.map(({ text, tone }, index) => (
              <Text key={text} size="inherit" tone={tone ?? "inherit"}>
                {index ? `· ${text}` : text}
              </Text>
            ))}
          </span>
        </span>
      </span>
    </Button>
  );

  return (
    <Text
      as="section"
      tone="inherit"
      aria-label={t("Turn activity")}
      data-activity-dock={dock.state}
      data-dock-subagents={dock.agents.some((agent) => agent.kind === "agent") ? "" : undefined}
      {...surfaceAttributes(
        { radius: "card", variant: "floating", material: "glass" },
        `activity-dock overflow-hidden font-sans ${
          dock.state === "done" ? "activity-dock-done" : ""
        }`,
      )}
    >
      {/* Announces a failed stop; the button itself only reads "Retry stop". */}
      <LiveText
        className="sr-only"
        text={stop.failed.size ? t("Could not stop it. Try again.") : ""}
      />
      <Text as="div" size="inherit" tone="secondary" className="relative" data-activity-status-row>
        <div className="relative flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
          {hasAgents ? toggle : summary}
          {dock.state === "needs-input" ? <DockApprovalActions blocks={blocks} /> : null}
          {!hasAgents ? stopAllButton : null}
          {goalControl}
        </div>
      </Text>
      {open ? (
        <div id={listId}>
          <Divider inset="md" decorative />
          {stopAllButton ? <div className="flex justify-end px-3 pt-1">{stopAllButton}</div> : null}
          <div
            ref={lockList}
            className="activity-dock-list flex max-h-60 flex-col gap-0.5 overflow-x-hidden overflow-y-auto overscroll-none px-1 py-1"
          >
            {/* Running rows lead, so their Stop buttons are not buried under
              finished ones. The sort is stable: transcript order otherwise. */}
            {renderDockAgentGroups(listed, t("Workflow"), (agent) => (
              <DockAgentRow
                key={agent.blockId}
                agent={agent}
                harness={harness}
                onOpen={onOpenAgent}
                stop={stop}
              />
            ))}
          </div>
        </div>
      ) : null}
    </Text>
  );
}

function renderDockAgentGroups(
  agents: readonly DockAgent[],
  workflowLabel: string,
  row: (agent: DockAgent) => React.ReactNode,
) {
  const { standalone, phases } = groupDockAgents(
    [...agents].sort((a, b) => Number(b.status === "running") - Number(a.status === "running")),
  );
  return (
    <>
      {standalone.map(row)}
      {phases.map(({ id, phase, agents }) => (
        <div key={id}>
          <Text size="caption" tone="muted" className="px-2 py-1">
            {phase ? `${workflowLabel} · ${phase}` : workflowLabel}
          </Text>
          {agents.map(row)}
        </div>
      ))}
    </>
  );
}

/** Its own component so only the clock re-renders each second. */
function DockClock({ startedAt }: { startedAt?: number }) {
  useLocale();
  const elapsed = formatElapsed(useElapsedFrom(startedAt, false));
  return (
    <Text as="span" size="inherit" className="activity-dock-clock shrink-0 tabular-nums">
      {elapsed}
    </Text>
  );
}

function DockMark({ state }: { state: ActivityDockModel["state"] }) {
  const t = useT();
  if (state === "background") return <WorkingIndicator size="xs" />;
  if (state === "done") {
    return (
      <Check className="icon-sm shrink-0 activity-dock-check" tone="success" strokeWidth={2} />
    );
  }
  if (state === "needs-input") {
    return <CircleAlert className="icon-sm shrink-0" tone="warning" strokeWidth={1.75} />;
  }
  return (
    <StatusDot
      label={t(state === "working" ? "Working" : "Waiting")}
      aria-hidden
      tone={state === "working" ? "accent" : "neutral"}
    />
  );
}

const STATUS_TONE = {
  running: "accent",
  done: "secondary",
  failed: "danger",
  stopped: "warning",
  interrupted: "warning",
} as const satisfies Record<DockAgent["status"], TextTone>;

/** Each provider running the listed work, once. */
function ProviderStack({
  agents,
  fallback,
}: {
  agents: readonly DockAgent[];
  fallback?: HarnessId;
}) {
  const providers = [
    ...new Set(
      agents.flatMap((agent) =>
        agent.kind === "agent" && (agent.harness ?? fallback) ? [agent.harness ?? fallback!] : [],
      ),
    ),
  ].slice(0, 4);
  if (!providers.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true" data-dock-providers>
      {providers.map((provider) => (
        <HarnessIcon key={provider} harness={provider} size="sm" />
      ))}
    </span>
  );
}

function accountSnapshot(provider: HarnessId | undefined, accountId: string | undefined): string {
  if (!provider || !accountId || !supportsProviderAccounts(provider)) return "";
  const account = providerAccounts(provider).find((item) => item.id === accountId);
  return account ? JSON.stringify(account) : "";
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
  const provider = agent.harness ?? harness;
  // The account list lives in storage; a string snapshot keeps the subscription value-stable.
  const accountJson = useSyncExternalStore(subscribeProviderAccounts, () =>
    accountSnapshot(provider, agent.providerAccountId),
  );
  const account: ProviderAccount | undefined = accountJson ? JSON.parse(accountJson) : undefined;
  const accountLabel = account?.label ?? agent.providerAccountId;
  const summary = [agent.name, agent.model, accountLabel, agent.detail, statusWord]
    .filter(Boolean)
    .join(", ");
  const key = agent.callId ?? agent.blockId;
  const stoppable = canStopAgent(agent, stop.perItem) && !!stop.onAgent;
  const stopping = stop.stopping.has(key);
  return (
    <div className="activity-dock-item flex min-w-0 items-start py-0.5">
      <Button
        variant="item"
        type="button"
        aria-label={t(agent.kind === "agent" ? "Open {p0}" : "Show {p0}", { p0: summary })}
        data-dock-agent={agent.blockId}
        data-dock-agent-state={agent.status}
        onClick={() => onOpen(agent)}
        className="activity-dock-agent min-w-0 flex-1 items-center text-left"
      >
        {/* The provider leads an agent row, so mixed-provider runs read apart at a glance;
            a command has no provider and keeps its state mark. */}
        <span className="flex shrink-0 self-start pt-0.5" aria-hidden="true" data-dock-agent-lead>
          {agent.kind === "agent" && provider ? (
            <HarnessIcon harness={provider} size="md" />
          ) : (
            <AgentStatusDot status={agent.status} size="md" />
          )}
        </span>
        <span className="activity-dock-agent-identity flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-start gap-1.5" data-dock-agent-title>
            <ClampText
              as="span"
              lines={2}
              expandable={false}
              size="inherit"
              tone="neutral"
              weight="medium"
              className="whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {agent.name}
              {agent.crewMember?.handle ? (
                <Text size="inherit" tone="muted" weight="regular" className="ml-1.5">
                  @{agent.crewMember.handle}
                </Text>
              ) : null}
              {agent.round && agent.round > 1 ? (
                <Badge size="xs" appearance="subtle" tone="neutral" className="ml-1.5">
                  {t("Round {p0}", { p0: agent.round })}
                </Badge>
              ) : null}
            </ClampText>
          </span>
          {agent.kind === "agent" ? (
            <Text size="micro" tone="muted" className="flex min-w-0 items-center gap-1.5">
              <Text size="inherit" tone="inherit" truncate>
                {agent.model ?? t("Subagent")}
              </Text>
              {account ? <AccountColorDot account={account} /> : null}
              {accountLabel ? (
                <Text size="inherit" tone="inherit" truncate>
                  {accountLabel}
                </Text>
              ) : null}
              {agent.nested ? (
                <Text size="inherit" tone="inherit" className="shrink-0" data-dock-agent-nested>
                  {t("Subagents: {p0}", { p0: agent.nested })}
                </Text>
              ) : null}
              {agent.needsInput ? (
                <Badge size="xs" tone="warning" appearance="subtle" className="shrink-0">
                  {t("Needs input")}
                </Badge>
              ) : null}
            </Text>
          ) : null}
        </span>
        <Text
          size="inherit"
          tone="secondary"
          className="activity-dock-agent-metrics flex shrink-0 flex-wrap items-center justify-end gap-x-2"
        >
          {agent.detail ? (
            <Text
              size="inherit"
              tone={
                agent.status === "failed"
                  ? "danger"
                  : agent.status === "stopped" || agent.status === "interrupted"
                    ? "warning"
                    : "inherit"
              }
              className="min-w-0"
            >
              {agent.detailParts ? (
                <SubagentStatusSummary parts={agent.detailParts} />
              ) : (
                agent.detail
              )}
            </Text>
          ) : null}
          {/* A detail that already names the state ("Interrupted", "stopped by you") keeps it once. */}
          {agent.detail?.toLocaleLowerCase().includes(statusWord.toLocaleLowerCase()) ? null : (
            <Text
              size="inherit"
              tone={STATUS_TONE[agent.status]}
              weight={agent.status === "failed" ? "medium" : undefined}
              className="inline-flex shrink-0 items-center gap-1"
              data-dock-agent-status
            >
              <AgentStatusDot status={agent.status} />
              {statusWord}
            </Text>
          )}
          <AgentClock
            startedAt={agent.startedAt}
            endedAt={agent.endedAt}
            live={agent.status === "running"}
          />
        </Text>
        <ChevronRight className="icon-xs shrink-0" tone="secondary" strokeWidth={1.75} />
      </Button>
      {stoppable ? (
        <Button
          className="mr-1 shrink-0"
          variant="ghost"
          type="button"
          disabled={stopping}
          startIcon={<Square className="icon-xs" strokeWidth={1.75} />}
          reserveLabels={[t("Stop"), t("Stopping…"), t("Retry stop")]}
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
          {stopping ? t("Stopping…") : stop.failed.has(key) ? t("Retry stop") : t("Stop")}
        </Button>
      ) : null}
    </div>
  );
}

export function AgentStatusDot({
  status,
  size = "xs",
}: {
  status: DockAgent["status"];
  size?: "xs" | "md";
}) {
  useLocale();
  if (status === "running") return <WorkingIndicator size={size} />;
  const className = `${size === "md" ? "icon-md" : "icon-xs"} shrink-0`;
  if (status === "done") return <Check className={className} tone="success" strokeWidth={2} />;
  if (status === "failed") {
    return <X className={className} tone="danger" strokeWidth={2} />;
  }
  if (status === "stopped") {
    return <Square className={className} tone="warning" strokeWidth={2} />;
  }
  if (status === "interrupted") {
    return <CircleAlert className={className} tone="warning" strokeWidth={2} />;
  }
  return null;
}
