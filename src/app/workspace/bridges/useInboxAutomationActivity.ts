import { useCallback } from "react";
import { claimInboxAutomationRuns } from "../../../features/automations/model/automationEvents";
import type { Automation, AutomationRun } from "../../../features/automations/model/automations";
import type { LinkedWorkItem } from "../../../features/sessions/model/session";

export interface InboxAutomationActivityDeps {
  ensureAutomationRecovery: () => Promise<unknown>;
  launchAutomation: (
    automation: Automation,
    run: AutomationRun,
    reveal?: boolean,
    prompt?: string,
    sourceWorkItem?: LinkedWorkItem,
  ) => Promise<unknown>;
}

/** Claims due inbox automation runs when inbox activity arrives. */
export function useInboxAutomationActivity(deps: InboxAutomationActivityDeps) {
  const { ensureAutomationRecovery, launchAutomation } = deps;
  return useCallback(
    (
      items: Parameters<typeof claimInboxAutomationRuns>[0],
      transitions: Parameters<typeof claimInboxAutomationRuns>[2],
    ) => {
      void ensureAutomationRecovery()
        .then(() => claimInboxAutomationRuns(items, Date.now(), transitions))
        .then((due) => {
          for (const item of due) {
            void launchAutomation(
              item.automation,
              item.run,
              false,
              item.prompt,
              item.linkedWorkItem,
            ).catch((error) => {
              console.warn("App operation failed", error);
            });
          }
        })
        .catch((error) => {
          console.warn("App operation failed", error);
        });
    },
    [ensureAutomationRecovery, launchAutomation],
  );
}
