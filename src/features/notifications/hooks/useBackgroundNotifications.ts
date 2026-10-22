import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
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

/** Only one workspace window watches, so each change is announced once. */
export async function isLeadWindow(): Promise<boolean> {
  let own: string;
  try {
    own = getCurrentWindow().label;
  } catch {
    return false;
  }
  try {
    const labels = (await getAllWebviewWindows())
      .map((window) => window.label)
      .filter((label) => !label.startsWith("quick-composer"))
      .sort();
    return (labels[0] ?? own) === own;
  } catch {
    // Window labels are unique. The canonical workspace remains a single
    // fallback owner when enumeration is unavailable; unidentified windows
    // cannot safely claim ownership.
    return own === "main";
  }
}

/** Watches every machine's task board, goals and background automations, with
 * or without their views open, and raises an OS notification when one
 * finishes for review, gets blocked, fails, or waits on the owner. The first
 * poll only records where things stand. */
export function useBackgroundNotifications(tasksViewOpen: boolean) {
  // The Tasks view polls the boards itself and shows every change; while it
  // is open the boards are left alone here, and watched afresh once it closes.
  const tasksViewOpenRef = useRef(tasksViewOpen);
  tasksViewOpenRef.current = tasksViewOpen;
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let previous: BackgroundSnapshot | null = null;
    const poll = async () => {
      if (running) return;
      // Off: nothing to announce, and turning it on starts from a new baseline.
      if (!loadNotificationsEnabled() || !(await isLeadWindow())) {
        previous = null;
        return;
      }
      running = true;
      try {
        const watchTasks = !tasksViewOpenRef.current;
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
        if (cancelled) return;
        const seen = backgroundSnapshot(tasks, automations, goals);
        if (previous && !watchTasks) {
          previous.tasks.clear();
          previous.goals.clear();
        }
        if (previous) {
          const next = carryForward(previous, seen);
          for (const transition of backgroundTransitions(previous, next))
            void notifyBackground(transition);
          previous = next;
        } else previous = seen;
      } catch {
        // A machine list that cannot be read is tried again next time.
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
