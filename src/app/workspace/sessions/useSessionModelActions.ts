import { useCallback, type MutableRefObject } from "react";
import {
  bindHarnessSession,
  forgetHarnessSession,
  type HarnessEvent,
} from "../../../integrations/harness";
import { switchSessionAccount } from "../../../features/sessions/model/accountSwitch";
import {
  isPreparingHandoff,
  planComposerSwitch,
  withAccountHandoff,
  withHarnessChoice,
} from "../../../features/sessions/model/handoff";
import {
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "../../../features/sessions/model/models";
import { queuedModelTarget } from "../../../features/sessions/model/messageQueue";
import {
  providerAccountLabel,
  sessionProviderAccountId,
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../../features/providers/model/providerAccounts";
import {
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import { transferProviderSession } from "../../../platform/tauri/providerSessionTransfer";

export interface SessionModelActionDeps {
  isMovingPane: (paneId: string) => boolean;
  removingSessionIds: MutableRefObject<Set<string>>;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
  promptProviderAccountSignIn: (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
}

export function useSessionModelActions({
  isMovingPane,
  removingSessionIds,
  enqueueHarnessEvent,
  flushHarnessEvents,
  promptProviderAccountSignIn,
}: SessionModelActionDeps) {
  const onModelChange = useCallback(
    async (sessionId: string, harness: HarnessId, model: string, accountId?: string) => {
      if (isMovingPane(sessionId)) return;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      let accountUpdate: ((session: Session) => Session) | undefined;
      if (accountId && supportsProviderAccounts(harness)) {
        if (
          current.busy &&
          (current.harness !== harness || sessionProviderAccountId(harness, current) !== accountId)
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Wait for the current turn to finish before switching accounts.",
          });
          flushHarnessEvents();
          return;
        }
        if (current.harness === harness) {
          const result = await switchSessionAccount(sessionId, harness, accountId, {
            transfer: transferProviderSession,
            forget: forgetHarnessSession,
            bind: bindHarnessSession,
            latest: (id) => sessionsRef.current.find((s) => s.id === id),
            label: providerAccountLabel,
            removing: (id) => removingSessionIds.current.has(id),
          });
          if (result.kind === "stale" || result.kind === "refused") return;
          if (result.kind === "switched") {
            accountUpdate = result.update;
            if (result.status) {
              enqueueHarnessEvent(sessionId, {
                type: "status",
                text: result.status,
              });
              flushHarnessEvents();
            }
          }
        }
      }
      const resolved = resolveModel(harness, model);
      saveRecentModelChoice(resolved.harness, resolved.id);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(resolved, current.modelSettings);
      const plan = planComposerSwitch(current, harness);
      if (
        plan.kind === "revert" &&
        accountId &&
        accountId !== (plan.restoreProviderAccountId ?? "default")
      ) {
        await forgetHarnessSession(harness, sessionId);
      }
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const next = withHarnessChoice(
            accountUpdate ? accountUpdate(s) : s,
            harness,
            resolved.id,
            modelSettings,
          );
          if (accountId && supportsProviderAccounts(harness)) next.providerAccountId = accountId;
          if (s.busy && !s.runningModelTarget)
            next.runningModelTarget = {
              ...queuedModelTarget(s),
              providerAccountId: supportsProviderAccounts(s.harness)
                ? sessionProviderAccountId(s.harness, s)
                : undefined,
            };
          if (plan.kind === "arm") {
            return { ...next, pendingSwitch: plan.pending };
          }
          if (plan.kind === "revert") {
            if (accountId && accountId !== (plan.restoreProviderAccountId ?? "default")) {
              return withAccountHandoff({ ...next, pendingSwitch: undefined }, accountId);
            }
            return {
              ...next,
              pendingSwitch: undefined,
              ...(plan.restoreProviderSessionId
                ? { providerSessionId: plan.restoreProviderSessionId }
                : { providerSessionId: undefined }),
              ...(plan.restoreProviderAccountId
                ? {
                    providerAccountId: accountId ?? plan.restoreProviderAccountId,
                  }
                : { providerAccountId: accountId }),
            };
          }
          if (plan.kind === "empty") {
            return { ...next, pendingSwitch: undefined };
          }
          return next;
        }),
      );
      if (accountId && supportsProviderAccounts(harness)) {
        promptProviderAccountSignIn(sessionId, harness, accountId);
      }
    },
    [enqueueHarnessEvent, flushHarnessEvents, promptProviderAccountSignIn],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      if (isMovingPane(sessionId)) return;
      saveLastModelSettings(modelSettings);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                modelSettings,
                runningModelTarget: s.busy
                  ? (s.runningModelTarget ?? {
                      ...queuedModelTarget(s),
                      providerAccountId: supportsProviderAccounts(s.harness)
                        ? sessionProviderAccountId(s.harness, s)
                        : undefined,
                    })
                  : undefined,
              }
            : s,
        ),
      );
    },
    [],
  );

  const onRuntimeModeChange = useCallback((sessionId: string, runtimeMode: RuntimeMode) => {
    if (isMovingPane(sessionId)) return;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, runtimeMode } : s)));
  }, []);

  return { onModelChange, onModelSettingsChange, onRuntimeModeChange };
}
