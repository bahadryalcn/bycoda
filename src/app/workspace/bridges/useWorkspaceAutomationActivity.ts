import { useEffect } from "react";
import { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
import {
  listAutomations,
  automationTriggers,
} from "../../../features/automations/model/automations";
import { probeMachines } from "../../../features/automations/model/hostAutomationClient";
import { machineProjects } from "../../../features/automations/model/machineSnapshot";
import {
  claimWorkspaceAutomationRuns,
  taskAutomationEvents,
  socialAutomationEvents,
  type WorkspaceAutomationEvent,
} from "../../../features/automations/model/workspaceAutomationEvents";
import { listBoardTasks, taskMachines } from "../../../features/tasks/model/taskClient";
import { socialClient } from "../../../features/social/model/socialClient";
import { SOCIAL_CAPABILITY } from "../../../features/social/model/social";
import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { AUTOMATION_POLL_DEADLINES } from "./automationPollDeadlines";
import type { InboxAutomationActivityDeps } from "./useInboxAutomationActivity";

/** Only reads event sources when the owner has enabled a matching automation. */
export function useWorkspaceAutomationActivity({
  ensureAutomationRecovery,
  launchAutomation,
}: InboxAutomationActivityDeps) {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let taskStates: Map<string, string> | undefined;
    let running = false;
    const pending = new Map<string, WorkspaceAutomationEvent>();
    const recoveryToken = crypto.randomUUID();
    // A hidden window reads no event sources; visibility resumes the poll at once.
    const resume = () => {
      if (document.hidden || disposed) return;
      clearTimeout(timer);
      void poll().catch((error: unknown) => console.warn("Automation activity poll failed", error));
    };
    const poll = async () => {
      if (running || disposed || document.hidden) return;
      running = true;
      try {
        const lead = await withTimeout(
          isLeadWindow(),
          AUTOMATION_POLL_DEADLINES.leaderCheckMs,
          "Workspace leader check",
        );
        if (!lead || disposed) return;
        const automations = (
          await withTimeout(
            listAutomations(),
            AUTOMATION_POLL_DEADLINES.localReadMs,
            "Automation list",
          )
        ).filter((automation) => automation.enabled);
        const kinds = new Set(
          automations.flatMap((automation) =>
            automationTriggers(automation).map((trigger) => trigger.kind),
          ),
        );
        const events: WorkspaceAutomationEvent[] = [];
        const reads: Promise<void>[] = [];
        if (kinds.has("tasks"))
          reads.push(
            (async () => {
              // State commits only after the bounded read returns; a late result is
              // dropped, so the previous snapshot still detects the next transition.
              const tasks = await withTimeout(
                (async () => listBoardTasks(await taskMachines()))(),
                AUTOMATION_POLL_DEADLINES.remoteReadMs,
                "Task automation read",
              );
              events.push(...taskAutomationEvents(tasks, taskStates));
              taskStates = new Map(
                tasks.map((task) => [
                  `${task.machineId}:${task.id}`,
                  task.stale
                    ? (taskStates?.get(`${task.machineId}:${task.id}`) ?? task.status)
                    : task.status,
                ]),
              );
            })(),
          );
        if (kinds.has("social"))
          reads.push(
            (async () => {
              const reach = await withTimeout(
                probeMachines(SOCIAL_CAPABILITY),
                AUTOMATION_POLL_DEADLINES.remoteReadMs,
                "Social machine probe",
              );
              // Each machine has its own deadline so one stalled host cannot hide the rest.
              const results = await Promise.allSettled(
                reach.capable.map((machine) =>
                  withTimeout(
                    Promise.all([
                      socialClient(machine.id).snapshot(),
                      machineProjects(machine),
                    ]).then(([snapshot, projects]) =>
                      socialAutomationEvents(snapshot, machine, projects),
                    ),
                    AUTOMATION_POLL_DEADLINES.remoteReadMs,
                    `Social automation read (${machine.id})`,
                  ),
                ),
              );
              for (const result of results)
                if (result.status === "fulfilled") events.push(...result.value);
                else console.warn("Social automation source unavailable", result.reason);
            })(),
          );
        const sourceResults = await Promise.allSettled(reads);
        for (const result of sourceResults)
          if (result.status === "rejected")
            console.warn("Automation event source unavailable", result.reason);
        if (disposed) return;
        for (const event of events) pending.set(event.key, event);
        if (!pending.size) return;
        // Wait on the shared recovery without restarting it; on timeout the events
        // stay pending and the next poll waits on the same recovery again.
        await withTimeout(
          ensureAutomationRecovery(),
          AUTOMATION_POLL_DEADLINES.recoveryWaitMs,
          "Automation recovery",
        );
        if (disposed) return;
        const failed = new Set<string>();
        for (const item of await claimWorkspaceAutomationRuns(
          automations,
          [...pending.values()],
          (event, error) => {
            failed.add(event.key);
            console.warn("Automation event claim failed", event.key, error);
          },
          recoveryToken,
        )) {
          try {
            await withTimeout(
              launchAutomation(item.automation, item.run, false, item.prompt),
              AUTOMATION_POLL_DEADLINES.launchAcceptMs,
              "Automation launch",
            );
          } catch (error) {
            // The claimed run keeps launching on its own; it is never claimed or launched again.
            if (!(error instanceof TimeoutError)) throw error;
            console.warn("Automation launch is still pending", item.run.id, error);
          }
        }
        for (const key of pending.keys()) if (!failed.has(key)) pending.delete(key);
      } catch (error) {
        console.warn("Workspace automation activity failed", error);
      } finally {
        running = false;
        if (!disposed && !document.hidden) timer = setTimeout(poll, 30_000);
      }
    };
    document.addEventListener("visibilitychange", resume);
    void poll().catch((error: unknown) => console.warn("Automation activity poll failed", error));
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", resume);
      clearTimeout(timer);
    };
  }, [ensureAutomationRecovery, launchAutomation]);
}
