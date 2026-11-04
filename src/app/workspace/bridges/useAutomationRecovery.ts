import { useCallback, useEffect, useRef } from "react";
import {
  claimDueAutomations,
  recoverAutomationRuns,
} from "../../../features/automations/model/automations";
import type { useAutomationLaunch } from "./useAutomationLaunch";
import { refreshSshRunbookQueue } from "../../../features/connections/model/sshRunbookQueue";

export interface AutomationRecoveryDeps {
  launchAutomation: ReturnType<typeof useAutomationLaunch>["launchAutomation"];
}

// Startup recovery of pending automation runs and the 30s due-run scheduler.
// Verbatim from Workspace.
//
// Recovery settles runs left over from an earlier process. Rust performs that
// pass once per process: the first window to mount gets the pending runs to
// relaunch, and every later window (a pop-out, a reload) gets an empty list,
// so the runs live in other windows are neither cancelled nor started twice.
export function useAutomationRecovery({ launchAutomation }: AutomationRecoveryDeps) {
  const automationRecoveryRef = useRef<Promise<void> | null>(null);
  // Only bounds the cutoff from below; Rust uses its process epoch.
  const automationRecoveryCutoffRef = useRef(Date.now());

  const ensureAutomationRecovery = useCallback(() => {
    if (!automationRecoveryRef.current) {
      const recovery = (async () => {
        const pending = await recoverAutomationRuns(automationRecoveryCutoffRef.current);
        for (const item of pending) {
          await launchAutomation(
            item.automation,
            item.run,
            false,
            item.run.prompt ?? item.automation.prompt,
          ).catch((error) => {
            console.warn("App operation failed", error);
          });
        }
      })();
      automationRecoveryRef.current = recovery.catch((error: unknown) => {
        automationRecoveryRef.current = null;
        throw error;
      });
    }
    return automationRecoveryRef.current;
  }, [launchAutomation]);

  useEffect(() => {
    let disposed = false;
    let evaluating = false;
    const evaluate = async () => {
      if (disposed || evaluating) return;
      evaluating = true;
      // Materialize review intents only. SSH execution always needs a new owner review.
      void refreshSshRunbookQueue();
      try {
        await ensureAutomationRecovery();
        const due = await claimDueAutomations();
        for (const item of due) {
          if (disposed) break;
          void launchAutomation(item.automation, item.run).catch(() => undefined);
        }
      } catch {
        // Scheduling retries on the next tick; individual claimed runs record
        // launch failures in launchAutomation.
      } finally {
        evaluating = false;
      }
    };
    void evaluate();
    const timer = window.setInterval(() => void evaluate(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void evaluate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ensureAutomationRecovery, launchAutomation]);

  return { ensureAutomationRecovery };
}
