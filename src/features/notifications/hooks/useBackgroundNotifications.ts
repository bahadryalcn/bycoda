import { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
export { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
import { useEffect } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { withTimeout } from "../../../shared/lib/withTimeout";
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
/** A poll still unfinished after this is abandoned, so one hung request or native
 * call cannot hold the gate shut; shorter than `POLL_MS`, the next tick starts anew. */
const POLL_DEADLINE_MS = 45_000;
/** The Automations view reads its boards every 30 s; an answer this recent is reused
 * instead of asking each Host again. Tasks and goals already share the board reads. */
const AUTOMATION_REUSE_MS = 35_000;

type PollState = {
  cancelled: boolean;
  running: boolean;
  /** Numbers each poll; an abandoned poll that finishes late is no longer current. */
  epoch: number;
  previous: BackgroundSnapshot | null;
};

async function readBackground(state: PollState, tasksViewOpen: () => boolean, epoch: number) {
  const current = () => !state.cancelled && state.epoch === epoch;
  // Reserve the poll before the native census; it may outlive the interval.
  if (!loadNotificationsEnabled() || !(await isLeadWindow()) || !loadNotificationsEnabled()) {
    if (current()) state.previous = null;
    return;
  }
  if (!current()) return;
  const watchTasks = !tasksViewOpen();
  const [taskMachines, automationMachines, goalMachines] = await Promise.all([
    watchTasks ? backgroundMachines(HOST_TASKS) : [],
    backgroundMachines(HOST_AUTOMATIONS),
    watchTasks ? backgroundMachines(HOST_GOALS) : [],
  ]);
  if (!current()) return;
  const [tasks, automations, goals] = await Promise.all([
    listBoardTasks(taskMachines),
    listHostAutomations(automationMachines, { maxAgeMs: AUTOMATION_REUSE_MS }),
    listBoardGoals(goalMachines),
  ]);
  if (!current()) return;
  if (!loadNotificationsEnabled()) {
    state.previous = null;
    return;
  }
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
}

async function pollBackground(state: PollState, tasksViewOpen: () => boolean) {
  if (state.cancelled || state.running) return;
  state.running = true;
  const epoch = ++state.epoch;
  try {
    await withTimeout(
      readBackground(state, tasksViewOpen, epoch),
      POLL_DEADLINE_MS,
      "Background notification poll",
    );
  } catch {
    // A machine list that cannot be read, or a poll that never answered, is tried again next time;
    // the last snapshot stays the baseline.
  } finally {
    // Retire this poll's epoch: if it was abandoned, its late result is discarded.
    state.epoch++;
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the background notification polling timer and discard pending results after unmount.
  useEffect(() => {
    const state: PollState = { cancelled: false, running: false, epoch: 0, previous: null };
    const poll = () => pollBackground(state, isTasksViewOpen);
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      state.cancelled = true;
      clearInterval(timer);
    };
  }, [isTasksViewOpen]);
}
