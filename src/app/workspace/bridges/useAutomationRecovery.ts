import { useCallback, useEffect, useRef } from "react";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { electLeadWindow } from "../../../platform/tauri/workspaceWindows";
import {
  claimDueAutomations,
  recoverAutomationRuns,
} from "../../../features/automations/model/automations";
import type { useAutomationLaunch } from "./useAutomationLaunch";
import { refreshSshRunbookQueue } from "../../../features/connections/model/sshRunbookQueue";
import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { AUTOMATION_POLL_DEADLINES } from "./automationPollDeadlines";

export interface AutomationRecoveryDeps {
  launchAutomation: ReturnType<typeof useAutomationLaunch>["launchAutomation"];
}

// Startup recovery of pending automation runs and the 30s due-run scheduler.
// Verbatim from Workspace.
export function useAutomationRecovery({ launchAutomation }: AutomationRecoveryDeps) {
  const automationRecoveryRef = useRef<Promise<void> | null>(null);
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
    // A lead-gone event that arrived mid-evaluation; the running evaluation re-elects once it settles.
    let rerun = false;
    // undefined until an election succeeds, and again after a failed one, so the next tick retries.
    let leading: boolean | undefined;
    let lastElection = 0;
    let unlistenLead: (() => void) | undefined;
    // A due claim that outlived its deadline. The next tick awaits this same call
    // instead of claiming again, so its runs are launched once when it settles.
    let dueClaim: ReturnType<typeof claimDueAutomations> | undefined;
    // Non-leading windows stop polling; the lead's destruction re-elects at once. This fallback
    // census covers a lead that vanished without a destroyed event (crash).
    const NON_LEADER_FALLBACK_MS = 5 * 60_000;
    const stopWatchingLead = () => {
      unlistenLead?.();
      unlistenLead = undefined;
    };
    const onLeadGone = () => {
      stopWatchingLead();
      leading = undefined;
      if (evaluating) rerun = true;
      else void evaluate();
    };
    const watchLead = async (lead: WebviewWindow | null) => {
      stopWatchingLead();
      if (!lead) return;
      const unlisten = await lead.listen("tauri://destroyed", onLeadGone);
      if (disposed) unlisten();
      else unlistenLead = unlisten;
    };
    const evaluate = async () => {
      if (disposed || evaluating) return;
      evaluating = true;
      try {
        const election = await withTimeout(
          electLeadWindow(),
          AUTOMATION_POLL_DEADLINES.leaderCheckMs,
          "Workspace leader check",
        );
        lastElection = Date.now();
        leading = election.leader;
        if (disposed) return;
        if (!election.leader) {
          await watchLead(election.lead);
          return;
        }
        stopWatchingLead();
        // Keep one background scheduler alive even with hidden workspaces.
        // Explicit recovery callers still use their original admission path.
        void refreshSshRunbookQueue().catch((error: unknown) =>
          console.warn("SSH runbook queue refresh failed", error),
        );
        // Waits on the shared recovery without restarting it; a stalled recovery
        // blocks due claims (recovery first) but never the next tick.
        await withTimeout(
          ensureAutomationRecovery(),
          AUTOMATION_POLL_DEADLINES.recoveryWaitMs,
          "Automation recovery",
        );
        if (disposed) return;
        const call = (dueClaim ??= claimDueAutomations());
        let due: Awaited<typeof call>;
        try {
          due = await withTimeout(call, AUTOMATION_POLL_DEADLINES.dueClaimMs, "Due automation claim");
        } catch (error) {
          if (!(error instanceof TimeoutError)) dueClaim = undefined;
          throw error;
        }
        dueClaim = undefined;
        for (const item of due) {
          if (disposed) break;
          void launchAutomation(item.automation, item.run).catch((error: unknown) =>
            console.warn("Due automation launch failed", item.run.id, error),
          );
        }
      } catch (error) {
        // Scheduling retries on the next tick; individual claimed runs record
        // launch failures in launchAutomation.
        leading = undefined;
        console.warn("Automation scheduler tick failed", error);
      } finally {
        evaluating = false;
        if (rerun && !disposed) {
          rerun = false;
          void evaluate();
        }
      }
    };
    void evaluate();
    const timer = window.setInterval(() => {
      if (leading === false && Date.now() - lastElection < NON_LEADER_FALLBACK_MS) return;
      void evaluate();
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && leading !== false) void evaluate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      stopWatchingLead();
    };
  }, [ensureAutomationRecovery, launchAutomation]);

  return { ensureAutomationRecovery };
}
