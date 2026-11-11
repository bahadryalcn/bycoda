import { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
export { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
import { useEffect } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import {
  backgroundMachines,
  listHostAutomations,
} from "../../automations/model/hostAutomationClient";
import { HOST_AUTOMATIONS } from "../../automations/model/hostAutomations";
import { HOST_GOALS } from "../../tasks/model/hostGoals";
import { HOST_TASKS } from "../../tasks/model/hostTasks";
import { listBoardGoals } from "../../tasks/model/goalClient";
import { listBoardTasks } from "../../tasks/model/taskClient";
import {
  backgroundSnapshot,
  backgroundTransitions,
  carryForward,
  type BackgroundSnapshot,
} from "../../tasks/model/taskTransitions";
import { loadNotificationsEnabled, notifyBackground } from "../model/notifications";

const POLL_MS = 60_000;

type PollState = { cancelled: boolean; running: boolean; previous: BackgroundSnapshot | null };

async function pollBackground(state: PollState, tasksViewOpen: () => boolean) {
  if (state.running) return;
  // Off: nothing to announce, and turning it on starts from a new baseline.
  if (!loadNotificationsEnabled() || !(await isLeadWindow())) {
    state.previous = null;
    return;
  }
  state.running = true;
  try {
    const watchTasks = !tasksViewOpen();
    const [taskMachines, automationMachines, goalMachines] = await Promise.all([
      watchTasks ? backgroundMachines(HOST_TASKS) : [],
      backgroundMachines(HOST_AUTOMATIONS),
      watchTasks ? backgroundMachines(HOST_GOALS) : [],
    ]);
    const [tasks, automations, goals] = await Promise.all([
      listBoardTasks(taskMachines),
      listHostAutomations(automationMachines),
      listBoardGoals(goalMachines),
    ]);
    if (state.cancelled) return;
    const seen = backgroundSnapshot(tasks, automations, goals);
    const previous = state.previous;
    if (previous && !watchTasks) {
      previous.tasks.clear();
      previous.goals.clear();
    }
    if (previous) {
      const next = carryForward(previous, seen);
      for (const transition of backgroundTransitions(previous, next))
        void notifyBackground(transition);
      state.previous = next;
    } else state.previous = seen;
  } catch {
    // A machine list that cannot be read is tried again next time.
  } finally {
    state.running = false;
  }
}

/** Watches every machine's task board, goals and background automations, with
 * or without their views open, and raises an OS notification when one
 * finishes for review, gets blocked, fails, or waits on the owner. The first
 * poll only records where things stand. */
export function useBackgroundNotifications(tasksViewOpen: boolean) {
  // The Tasks view polls the boards itself and shows every change; while it
  // is open the boards are left alone here, and watched afresh once it closes.
  const isTasksViewOpen = useStableCallback(() => tasksViewOpen);
  useEffect(() => {
    const state: PollState = { cancelled: false, running: false, previous: null };
    const poll = () => pollBackground(state, isTasksViewOpen);
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      state.cancelled = true;
      clearInterval(timer);
    };
  }, [isTasksViewOpen]);
}
