import { useCallback, type MutableRefObject } from "react";
import {
  bindHarnessSession,
  forgetHarnessSession,
  type HarnessEvent,
} from "../../../integrations/harness";
import { repairStaleHandoff } from "../../../features/sessions/model/activeSubmits";
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
import { queuedModelTarget, runningTargetOf } from "../../../features/sessions/model/messageQueue";
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

const MOVING_PANE_NOTICE = "The conversation is being moved. Try the change again in a moment.";

export function useSessionModelActions({
  isMovingPane,
  removingSessionIds,
  enqueueHarnessEvent,
  flushHarnessEvents,
  promptProviderAccountSignIn,
}: SessionModelActionDeps) {
  const onModelChange = useCallback(
    async (sessionId: string, harness: HarnessId, model: string, accountId?: string) => {
      const say = (text: string) => {
        enqueueHarnessEvent(sessionId, { type: "status", text });
        flushHarnessEvents();
      };
      if (isMovingPane(sessionId)) {
        say(MOVING_PANE_NOTICE);
        return;
      }
      // A handoff block with no running submit behind it would block every pick.
      repairStaleHandoff(sessionId);
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) {
        say("Wait for the provider handoff to finish before changing the provider.");
        return;
      }
      let accountUpdate: ((session: Session) => Session) | undefined;
      const wantsAccount = !!accountId && supportsProviderAccounts(harness);
      // While a turn runs it keeps its own provider and account; a pick for
      // the same provider with another account waits for the next idle send.
      const running = current.busy ? runningTargetOf(current) : undefined;
      const runningAccount = running
        ? (running.providerAccountId ??
          (supportsProviderAccounts(running.harness) && running.harness === current.harness
            ? sessionProviderAccountId(running.harness, current)
            : undefined))
        : undefined;
      const deferAccount = !!(
        wantsAccount &&
        running &&
        harness === running.harness &&
        accountId !== runningAccount
      );
      // Account that takes effect now; a deferred or provider-less pick has none.
      const nowAccount = wantsAccount && !deferAccount ? accountId : undefined;
      // Idle only: a running turn is never moved, and an armed provider has no process yet.
      if (
        !running &&
        nowAccount &&
        supportsProviderAccounts(harness) &&
        current.harness === harness
      ) {
        let result: Awaited<ReturnType<typeof switchSessionAccount>>;
        try {
          result = await switchSessionAccount(sessionId, harness, nowAccount, {
            transfer: transferProviderSession,
            forget: forgetHarnessSession,
            bind: bindHarnessSession,
            latest: (id) => sessionsRef.current.find((s) => s.id === id),
            label: providerAccountLabel,
            removing: (id) => removingSessionIds.current.has(id),
          });
        } catch (error) {
          console.warn("App operation failed", error);
          say("Could not switch accounts. Try again.");
          return;
        }
        if (result.kind === "stale") {
          say("The conversation changed while switching accounts. Pick the account again.");
          return;
        }
        if (result.kind === "refused") {
          say(result.status);
          return;
        }
        if (result.kind === "switched") {
          accountUpdate = result.update;
          if (result.status) say(result.status);
        }
      }
      const resolved = resolveModel(harness, model);
      saveRecentModelChoice(resolved.harness, resolved.id);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(resolved, current.modelSettings);
      const plan = planComposerSwitch(current, harness);
      const handoffAccount =
        !running &&
        plan.kind === "revert" &&
        nowAccount &&
        nowAccount !== (plan.restoreProviderAccountId ?? "default");
      if (handoffAccount) {
        await forgetQuietly(harness, sessionId);
      }
      if (plan.kind === "empty") {
        void forgetQuietly(plan.forget, sessionId);
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
          if (nowAccount) next.providerAccountId = nowAccount;
          // A pick for another account of the running provider waits; any
          // other pick for it (or another provider) replaces a waiting one.
          if (deferAccount) next.nextProviderAccountId = accountId;
          else if (wantsAccount || next.harness !== s.harness)
            next.nextProviderAccountId = undefined;
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
            if (handoffAccount) {
              return withAccountHandoff({ ...next, pendingSwitch: undefined }, nowAccount);
            }
            return {
              ...next,
              pendingSwitch: undefined,
              ...(plan.restoreProviderSessionId
                ? { providerSessionId: plan.restoreProviderSessionId }
                : { providerSessionId: undefined }),
              ...(plan.restoreProviderAccountId
                ? {
                    providerAccountId: nowAccount ?? plan.restoreProviderAccountId,
                  }
                : { providerAccountId: nowAccount }),
            };
          }
          if (plan.kind === "empty") {
            return { ...next, pendingSwitch: undefined };
          }
          return next;
        }),
      );
      if (nowAccount && supportsProviderAccounts(harness)) {
        promptProviderAccountSignIn(sessionId, harness, nowAccount);
      } else if (deferAccount && accountId && supportsProviderAccounts(harness)) {
        say(
          `The next message will use ${providerAccountLabel(harness, accountId)}. The running turn keeps its account.`,
        );
        promptProviderAccountSignIn(sessionId, harness, accountId);
      }
    },
    [enqueueHarnessEvent, flushHarnessEvents, promptProviderAccountSignIn],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      if (isMovingPane(sessionId)) {
        enqueueHarnessEvent(sessionId, { type: "status", text: MOVING_PANE_NOTICE });
        flushHarnessEvents();
        return;
      }
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
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onRuntimeModeChange = useCallback(
    (sessionId: string, runtimeMode: RuntimeMode) => {
      if (isMovingPane(sessionId)) {
        enqueueHarnessEvent(sessionId, { type: "status", text: MOVING_PANE_NOTICE });
        flushHarnessEvents();
        return;
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, runtimeMode } : s)));
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  return { onModelChange, onModelSettingsChange, onRuntimeModeChange };
}

/** Cleanup trouble must not lose a pick: the next send spawns a fresh child anyway. */
async function forgetQuietly(harness: HarnessId, sessionId: string): Promise<void> {
  try {
    await forgetHarnessSession(harness, sessionId);
  } catch (error) {
    console.warn("App operation failed", error);
  }
}
