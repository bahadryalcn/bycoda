import { t } from "../../../shared/i18n";
import { hasPendingApproval, type Block } from "./session";
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

/** `stopped` is the user's doing, so it counts as neither done nor failed. */
export type DockAgentStatus = "running" | "done" | "failed" | "stopped";

/** One delegated run or background command in the latest turn. */
export type DockAgent = {
  /** The transcript block that owns the row, for jumping to it. */
  blockId: string;
  /** The provider's id for the call, which is how a stop request finds it. */
  callId?: string;
  name: string;
  /** Subagents open onto their own trail; commands only have a row. */
  kind: "agent" | "command";
  status: DockAgentStatus;
  model?: string;
  /** "46 steps, 1 failed", worded exactly as on the transcript row. */
  detail: string;
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
};

export type ActivityDockInput = {
  blocks: Block[];
  busy: boolean;
  pendingQuestion: boolean;
  backgroundTasks?: string[];
  backgroundAgents?: number;
  /** Work finished since the user last looked; see `nextUnseenDone`. */
  unseenDone: boolean;
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
}: ActivityDockInput): ActivityDock {
  const turn = lastTurn(blocks);
  const agents = turn.flatMap((block) => dockAgent(block, busy));
  const running = agents.filter((agent) => agent.status === "running").length;
  const failed = agents.filter((agent) => agent.status === "failed").length;
  const stopped = agents.filter((agent) => agent.status === "stopped").length;
  const backgroundCount = busy ? (backgroundTasks?.length ?? 0) : 0;
  const startedAt = turn.find((block) => block.role === "user")?.startedAt;

  let state: DockState = "idle";
  if (busy) {
    state =
      pendingQuestion || hasPendingApproval(blocks)
        ? "needs-input"
        : isBackgroundOnly(busy, backgroundTasks, backgroundAgents)
          ? "background"
          : backgroundCount > 0
            ? "waiting"
            : "working";
  } else if (unseenDone && !turn.some(isNoticeBlock)) {
    // A turn cut short or ended on an error has not "finished" anything.
    state = "done";
  }

  return {
    state,
    startedAt,
    backgroundCount,
    backgroundAgents: backgroundCount > 0 ? backgroundAgents : undefined,
    agents,
    running,
    finished: agents.length - running - failed - stopped,
    failed,
    stopped,
  };
}

function dockAgent(block: Block, busy: boolean): DockAgent[] {
  const agent = isSubagentBlock(block);
  if (!agent && !(isToolBlock(block) && block.tool?.background)) return [];
  if (isHiddenTool(block)) return [];
  const state = toolCallState(block);
  // A call still marked in flight once the session is idle is a leftover of an
  // interrupted turn, not something running.
  const status: DockAgentStatus = isStoppedBlock(block)
    ? "stopped"
    : state === "rejected"
      ? "failed"
      : state === "pending" && busy
        ? "running"
        : "done";
  return [
    {
      blockId: block.id,
      ...(block.tool?.callId ? { callId: block.tool.callId } : {}),
      name: agent ? subagentName(block) : toolCallLabel(block),
      kind: agent ? "agent" : "command",
      status,
      model: agent ? subagentModelName(block) : undefined,
      detail: agent
        ? subagentStatusLine(block, block.agentRun?.steps ?? [])
        : isStoppedBlock(block)
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
  return [
    dock.running ? t("{p0} running", { p0: dock.running }) : "",
    dock.finished ? t("{p0} done", { p0: dock.finished }) : "",
    dock.failed ? t("{p0} failed", { p0: dock.failed }) : "",
    dock.stopped ? t("{p0} stopped", { p0: dock.stopped }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
        p0: plural(dock.backgroundCount, "background command"),
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
