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
      void poll();
    };
    const poll = async () => {
      if (running || disposed || document.hidden) return;
      running = true;
      try {
        if (!(await isLeadWindow()) || disposed) return;
        const automations = (await listAutomations()).filter((automation) => automation.enabled);
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
              const tasks = await listBoardTasks(await taskMachines());
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
              const reach = await probeMachines(SOCIAL_CAPABILITY);
              const results = await Promise.allSettled(
                reach.capable.map(async (machine) => {
                  const [snapshot, projects] = await Promise.all([
                    socialClient(machine.id).snapshot(),
                    machineProjects(machine),
                  ]);
                  return socialAutomationEvents(snapshot, machine, projects);
                }),
              );
              for (const result of results)
                if (result.status === "fulfilled") events.push(...result.value);
            })(),
          );
        const sourceResults = await Promise.allSettled(reads);
        for (const result of sourceResults)
          if (result.status === "rejected")
            console.warn("Automation event source unavailable", result.reason);
        if (disposed) return;
        for (const event of events) pending.set(event.key, event);
        if (!pending.size) return;
        await ensureAutomationRecovery();
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
          await launchAutomation(item.automation, item.run, false, item.prompt);
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
    void poll();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", resume);
      clearTimeout(timer);
    };
  }, [ensureAutomationRecovery, launchAutomation]);
}
