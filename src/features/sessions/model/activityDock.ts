import { t } from "../../../shared/i18n";
import { hasPendingApproval, type Block } from "./session";
import { executionUserIndex } from "./executionTurn";
import {
  lastTurn,
  isHiddenTool,
  isNoticeBlock,
  isStoppedBlock,
  STOPPED_BY_YOU,
  isSubagentBlock,
  isToolBlock,
  subagentModelName,
  subagentName,
  subagentStatusLine,
  subagentStatusParts,
  type SubagentStatusPart,
  toolCallLabel,
  toolCallState,
} from "./transcriptActivity";

/**
 * What the turn is doing, from the reader's side of the glass:
 * - `working`: the agent itself is at it.
 * - `waiting`: the agent yielded, and subagents are still working for it.
 * - `background`: the agent has finished; only commands it left running (a
 *   dev server, a watcher) keep the turn open, and they may never end.
 * - `needs-input`: an approval or a question is waiting on the user.
 * - `done`: work finished since the user last looked.
 * - `idle`: nothing to say.
 */
export type DockState = "working" | "waiting" | "background" | "needs-input" | "done" | "idle";

/**
 * True when the agent's own work is over and the turn is only held open by
 * background commands. A provider that cannot tell commands from subagents
 * (`agents` undefined) never counts, so real work is never reported finished.
 */
export function isBackgroundOnly(
  busy: boolean,
  backgroundTasks: string[] | undefined,
  backgroundAgents: number | undefined,
): boolean {
  return busy && (backgroundTasks?.length ?? 0) > 0 && backgroundAgents === 0;
}

/**
 * `stopped` is the user's doing, so it counts as neither done nor failed.
 * `interrupted` is a call still marked in flight after the session went idle:
 * its real outcome was never reported, so it is neither done nor running.
 */
export type DockAgentStatus = "running" | "done" | "failed" | "stopped" | "interrupted";

/**
 * The one lifecycle rule for a delegated run or command, shared by the dock and
 * the details sheet so they cannot disagree. Provider/session state only; it is
 * not an OS process liveness check.
 */
export function blockLifecycle(block: Block, busy: boolean): DockAgentStatus {
  if (isStoppedBlock(block)) return "stopped";
  if (block.tool?.status?.toLowerCase() === "interrupted") return "interrupted";
  const state = toolCallState(block);
  if (state === "rejected") return "failed";
  if (state === "pending") return busy ? "running" : "interrupted";
  return "done";
}

/** One delegated run or background command in the latest turn. */
export type DockAgent = {
  /** The transcript block that owns the row, for jumping to it. */
  blockId: string;
  /** The provider's id for the call, which is how a stop request finds it. */
  callId?: string;
  name: string;
  /** Subagents open onto their own trail; commands only have a row. */
  kind: "agent" | "command";
  /** A delegated child session (cross-provider subagent); its own session id. */
  sessionId?: string;
  /** A delegated child waits for approval or an answer in its own session. */
  needsInput?: boolean;
  status: DockAgentStatus;
  model?: string;
  /** "46 steps, 1 failed", worded exactly as on the transcript row. */
  detail: string;
  detailParts?: SubagentStatusPart[];
  /** Epoch ms the run began and ended; absent on older sessions. */
  startedAt?: number;
  endedAt?: number;
};

export type ActivityDock = {
  state: DockState;
  /** Epoch ms the latest turn started, for the elapsed clock. */
  startedAt?: number;
  /** Background tasks the turn is held open by, as the provider reported them. */
  backgroundCount: number;
  /** How many of those are subagents; undefined when the provider cannot tell. */
  backgroundAgents?: number;
  agents: DockAgent[];
  running: number;
  finished: number;
  failed: number;
  stopped: number;
  interrupted: number;
};

export type ActivityDockInput = {
  blocks: Block[];
  busy: boolean;
  pendingQuestion: boolean;
  backgroundTasks?: string[];
  backgroundAgents?: number;
  /** Work finished since the user last looked; see `nextUnseenDone`. */
  unseenDone: boolean;
  /** Delegated child sessions of this session, already mapped to dock rows. */
  delegatedAgents?: DockAgent[];
};

/**
 * The one place the dock's counts, per-agent status and overall state come
 * from, so the lines it shows cannot disagree with each other.
 */
export function deriveActivityDock({
  blocks,
  busy,
  pendingQuestion,
  backgroundTasks,
  backgroundAgents,
  unseenDone,
  delegatedAgents = [],
}: ActivityDockInput): ActivityDock {
  // A steer is another user message in the same execution. Keep the original
  // run's rows and clock visible until a genuinely new execution starts.
  const visibleBlocks = blocks.filter((block) => !block.internal);
  const ownerIndex = executionUserIndex(visibleBlocks);
  const execution = ownerIndex < 0 ? lastTurn(visibleBlocks) : visibleBlocks.slice(ownerIndex);
  // Provider handoffs still fence activity, including imported/recovered data.
  let handoff = execution.length - 1;
  while (handoff >= 0 && execution[handoff].role !== "handoff") handoff--;
  const turn =
    handoff < 0
      ? execution
      : execution.slice(handoff === execution.length - 1 ? handoff : handoff + 1);
  const agents = [...turn.flatMap((block) => dockAgent(block, busy)), ...delegatedAgents];
  const running = agents.filter((agent) => agent.status === "running").length;
  const failed = agents.filter((agent) => agent.status === "failed").length;
  const stopped = agents.filter((agent) => agent.status === "stopped").length;
  const interrupted = agents.filter((agent) => agent.status === "interrupted").length;
  // Delegated children run in their own sessions. Once the parent turn has
  // ended, the ones still running are what keeps the dock open.
  const delegatedRunning = delegatedAgents.filter((agent) => agent.status === "running").length;
  const backgroundCount = busy ? (backgroundTasks?.length ?? 0) : delegatedRunning;
  const startedAt = turn.find((block) => block.role === "user")?.startedAt;

  let state: DockState = "idle";
  const childNeedsInput = delegatedAgents.some(
    (agent) => agent.needsInput && agent.status === "running",
  );
  if (busy) {
    state =
      pendingQuestion || hasPendingApproval(blocks) || childNeedsInput
        ? "needs-input"
        : isBackgroundOnly(busy, backgroundTasks, backgroundAgents)
          ? "background"
          : backgroundCount > 0
            ? "waiting"
            : "working";
  } else if (delegatedRunning > 0) {
    state = childNeedsInput ? "needs-input" : "background";
  } else if (unseenDone && !turn.some(isNoticeBlock)) {
    // A turn cut short or ended on an error has not "finished" anything.
    state = "done";
  }

  return {
    state,
    startedAt,
    backgroundCount,
    backgroundAgents:
      backgroundCount > 0 ? (busy ? backgroundAgents : delegatedRunning) : undefined,
    agents,
    running,
    finished: agents.length - running - failed - stopped - interrupted,
    failed,
    stopped,
    interrupted,
  };
}

function dockAgent(block: Block, busy: boolean): DockAgent[] {
  const agent = isSubagentBlock(block);
  if (!agent && !(isToolBlock(block) && block.tool?.background)) return [];
  if (isHiddenTool(block)) return [];
  // A call still marked in flight once the session is idle is a leftover of an
  // interrupted turn: not running, and not known to have finished either.
  const status = blockLifecycle(block, busy);
  return [
    {
      blockId: block.id,
      ...(block.tool?.callId ? { callId: block.tool.callId } : {}),
      name: agent ? subagentName(block) : toolCallLabel(block),
      kind: agent ? "agent" : "command",
      status,
      model: agent ? subagentModelName(block) : undefined,
      ...(agent && status !== "interrupted"
        ? { detailParts: subagentStatusParts(block, block.agentRun?.steps ?? []) }
        : {}),
      detail:
        status === "interrupted"
          ? t("Interrupted")
          : agent
            ? subagentStatusLine(block, block.agentRun?.steps ?? [])
            : status === "stopped"
              ? STOPPED_BY_YOU
              : "",
      ...(agent && block.agentRun?.startedAt !== undefined
        ? { startedAt: block.agentRun.startedAt }
        : {}),
      ...(agent && block.agentRun?.endedAt !== undefined
        ? { endedAt: block.agentRun.endedAt }
        : {}),
    },
  ];
}

/**
 * Tracks "finished since you last looked" across renders. Going from busy to
 * idle arms it; new work or the user looking (cleared by the caller) disarms
 * it. A session that was idle when first seen never arms it.
 */
export function nextUnseenDone(unseen: boolean, wasBusy: boolean, busy: boolean): boolean {
  if (busy) return false;
  return unseen || wasBusy;
}

/** "2 running · 1 done · 1 failed", leaving out what is zero. */
export function dockCountLabel(dock: ActivityDock): string {
  return dockCountParts(dock)
    .map((part) => part.text)
    .join(" · ");
}

export function dockCountParts(dock: ActivityDock): SubagentStatusPart[] {
  return [
    ...(dock.running
      ? [{ text: t("{p0} running", { p0: dock.running }), tone: "accent" as const }]
      : []),
    ...(dock.finished
      ? [{ text: t("{p0} done", { p0: dock.finished }), tone: "success" as const }]
      : []),
    ...(dock.failed
      ? [{ text: t("{p0} failed", { p0: dock.failed }), tone: "danger" as const }]
      : []),
    ...(dock.stopped
      ? [{ text: t("{p0} stopped", { p0: dock.stopped }), tone: "warning" as const }]
      : []),
    ...(dock.interrupted
      ? [{ text: t("{p0} interrupted", { p0: dock.interrupted }), tone: "warning" as const }]
      : []),
  ];
}

/** The state line's words, without the clock. */
export function dockStateLabel(dock: ActivityDock): string {
  switch (dock.state) {
    case "working":
      return t("Working");
    case "waiting": {
      if (dock.backgroundAgents === undefined) {
        return t("Waiting on {p0}", { p0: plural(dock.backgroundCount, "background task") });
      }
      const commands = dock.backgroundCount - dock.backgroundAgents;
      const agents = t("Waiting on {p0}", {
        p0: plural(dock.backgroundAgents, "background agent"),
      });
      return commands > 0
        ? t("{p0} · {p1} running", { p0: agents, p1: plural(commands, "command") })
        : agents;
    }
    case "background":
      return t("Finished · {p0} running", {
        p0:
          dock.backgroundAgents === dock.backgroundCount
            ? plural(dock.backgroundCount, "background agent")
            : plural(dock.backgroundCount, "background command"),
      });
    case "needs-input":
      return t("Needs your input");
    case "done":
      return t("Done");
    case "idle":
      return "";
  }
}

function plural(count: number, noun: string): string {
  if (noun === "background task")
    return t(count === 1 ? "{p0} background task" : "{p0} background tasks", { p0: count });
  if (noun === "background agent")
    return t(count === 1 ? "{p0} background agent" : "{p0} background agents", { p0: count });
  if (noun === "background command")
    return t(count === 1 ? "{p0} background command" : "{p0} background commands", { p0: count });
  return t(count === 1 ? "{p0} command" : "{p0} commands", { p0: count });
}
