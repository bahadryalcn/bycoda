import { t } from "../../../shared/i18n";
import { deriveActivityDock, type ActivityDock, type DockAgent } from "./activityDock";
import type { Session } from "./session";

/**
 * What a stop button does depends on what the harness can stop:
 * - `task`: it takes a request to stop one task by id (Claude Code's
 *   `stop_task`), so a row stops by itself and the turn goes on.
 * - `turn`: only the whole turn can be interrupted. There is no per-row button
 *   then; the one control says that it ends the turn.
 */
export type BackgroundStopKind = "task" | "turn";

/** How long a row says "Stopping…" before it gives the button back. */
export const STOPPING_TIMEOUT_MS = 10_000;

/** A running subagent or command that has a stop request to send. */
export function canStopAgent(agent: DockAgent, perItem: boolean): boolean {
  return perItem && agent.status === "running" && !!agent.callId;
}

export type StopAllControl = {
  kind: BackgroundStopKind;
  label: string;
  title: string;
};

/**
 * The dock's one stop-everything control, worded for what it will really do.
 * Null when nothing is running that it could stop.
 */
export function stopAllControl(dock: ActivityDock, perItem: boolean): StopAllControl | null {
  if (dock.state === "idle" || dock.state === "done") return null;
  if (dock.running === 0 && dock.backgroundCount === 0) return null;
  return perItem
    ? {
        kind: "task",
        get label() {
          return t("Stop all background work");
        },
        get title() {
          return t(
            "Stop every running subagent and background command. The turn itself is not interrupted.",
          );
        },
      }
    : {
        kind: "turn",
        get label() {
          return t("Stop all");
        },
        get title() {
          return t(
            "Interrupt the whole turn, subagents included. This harness cannot stop one of them on its own.",
          );
        },
      };
}

/** True when the session has a subagent or background command to stop. */
export function sessionHasBackgroundWork(session: Session): boolean {
  if (!session.busy) return false;
  const dock = deriveActivityDock({
    blocks: session.blocks,
    busy: true,
    pendingQuestion: false,
    backgroundTasks: session.backgroundTasks,
    backgroundAgents: session.backgroundAgents,
    unseenDone: false,
  });
  return dock.running > 0 || dock.backgroundCount > 0;
}
