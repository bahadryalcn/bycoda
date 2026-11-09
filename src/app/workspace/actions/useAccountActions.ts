import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Session } from "../../../features/sessions/model/session";
import {
  type ProviderAccountProvider,
  providerAccountExists,
} from "../../../features/providers/model/providerAccounts";
import { repairStaleHandoff } from "../../../features/sessions/model/activeSubmits";
import { isPreparingHandoff } from "../../../features/sessions/model/handoff";
import { deferPickUntilHandoffEnds } from "../../../features/sessions/model/deferredPicks";
import { showSubmitNotice } from "../sessions/submit/submitNotice";
import { recordModelSwitch } from "../sessions/recordModelSwitch";
import { t } from "../../../shared/i18n";
import { switchSessionAccount } from "../../../features/sessions/model/accountSwitch";
import { transferProviderSession } from "../../../platform/tauri/providerSessionTransfer";
import {
  bindHarnessSession,
  forgetHarnessSession,
  type HarnessEvent,
} from "../../../integrations/harness";
import { RESUME_PROMPT } from "../../../features/sessions/model/inFlight";
import type { useSubmitSession } from "../sessions/submit/useSubmitSession";

export interface UsageLimitAccountActionDeps {
  active: Session | undefined;
  sessionsRef: MutableRefObject<Session[]>;
  removingSessionIds: MutableRefObject<Set<string>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  isMovingPane: (paneId: string) => boolean;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
  promptProviderAccountSignIn: (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
  onSubmit: ReturnType<typeof useSubmitSession>["onSubmit"];
}

/** Usage-limit dismiss/resume and the session account switch (provider account changes). */
export function useUsageLimitAccountActions(deps: UsageLimitAccountActionDeps): {
  onUsageLimitDismiss: (sessionId: string) => void;
  onSwitchSessionAccount: (
    sessionId: string,
    provider: ProviderAccountProvider,
    accountId: string,
  ) => Promise<boolean>;
  onSelectProviderAccount: (provider: ProviderAccountProvider, accountId: string) => void;
  onUsageLimitResumeAtReset: (sessionId: string, enabled: boolean) => void;
  onUsageLimitResume: (sessionId: string) => void;
} {
  const {
    active,
    sessionsRef,
    removingSessionIds,
    setSessions,
    isMovingPane,
    enqueueHarnessEvent,
    flushHarnessEvents,
    promptProviderAccountSignIn,
    onSubmit,
  } = deps;
  const accountRequests = useRef(new Map<string, object>());
  const latestSwitch = useRef<
    (sessionId: string, provider: ProviderAccountProvider, accountId: string) => Promise<boolean>
  >(async () => false);

  const onUsageLimitDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.usageLimit
          ? { ...session, usageLimit: undefined }
          : session,
      ),
    );
  }, []);

  /** Move one session to another account of its provider, keeping the conversation. */
  const onSwitchSessionAccount = useCallback(
    async (sessionId: string, provider: ProviderAccountProvider, accountId: string) => {
      const say = (text: string) => {
        enqueueHarnessEvent(sessionId, { type: "status", text });
        flushHarnessEvents();
      };
      const owned = sessionsRef.current.find((session) => session.id === sessionId);
      if (owned && hostSessionBinding(owned)) {
        const selectAccount = remoteSessionActions(sessionId)?.selectAccount;
        if (!selectAccount) {
          say(
            "This conversation runs on the bycoda Host, which cannot switch its account from here.",
          );
          return false;
        }
        if (selectAccount(provider, accountId)) return true;
        say("This account cannot be used for the Host conversation. Pick another account.");
        return false;
      }
      const request = {};
      accountRequests.current.set(sessionId, request);
      const ownsRequest = () => accountRequests.current.get(sessionId) === request;
      if (isMovingPane(sessionId)) {
        say("The conversation is being moved. Pick the account again in a moment.");
        return false;
      }
      if (!providerAccountExists(provider, accountId)) {
        say("That account no longer exists. Pick another account.");
        return false;
      }
      repairStaleHandoff(sessionId);
      const during = sessionsRef.current.find((session) => session.id === sessionId);
      if (during && isPreparingHandoff(during)) {
        // The handoff owns the account until it ends: keep the pick and apply it afterwards.
        deferPickUntilHandoffEnds(sessionId, "account", () => {
          void latestSwitch.current(sessionId, provider, accountId);
        });
        showSubmitNotice(
          sessionId,
          t(
            "The provider handoff is still being prepared. Your pick applies as soon as it finishes.",
          ),
        );
        return true;
      }
      const result = await switchSessionAccount(sessionId, provider, accountId, {
        transfer: transferProviderSession,
        forget: forgetHarnessSession,
        bind: bindHarnessSession,
        latest: (id) => sessionsRef.current.find((s) => s.id === id),
        removing: (id) => removingSessionIds.current.has(id),
        ownsRequest,
      });
      if (!ownsRequest()) return false;
      if (result.kind === "refused") {
        say(result.status);
        return false;
      }
      if (result.kind === "deferred") {
        // A running turn keeps its account; the pick applies to the next send.
        const before = sessionsRef.current.find((s) => s.id === sessionId);
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? result.update(s) : s)));
        const waiting = sessionsRef.current.find((s) => s.id === sessionId)?.nextProviderAccountId;
        recordModelSwitch(
          sessionId,
          before,
          waiting ? { note: "deferred", accountId: waiting } : {},
        );
        promptProviderAccountSignIn(sessionId, provider, accountId);
        return true;
      }
      if (result.kind !== "switched") {
        if (result.kind === "noop") {
          promptProviderAccountSignIn(sessionId, provider, accountId);
        } else {
          say("The conversation changed while switching accounts. Pick the account again.");
        }
        return result.kind === "noop";
      }
      const latest = sessionsRef.current.find((s) => s.id === sessionId);
      if (!latest || result.update(latest) === latest) {
        say("The conversation changed while switching accounts. Pick the account again.");
        return false;
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? result.update(s) : s)));
      recordModelSwitch(sessionId, latest, result.mode === "handoff" ? { note: "summary" } : {});
      promptProviderAccountSignIn(sessionId, provider, accountId);
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents, promptProviderAccountSignIn],
  );

  latestSwitch.current = onSwitchSessionAccount;

  const onSelectProviderAccount = useCallback(
    (provider: ProviderAccountProvider, accountId: string) => {
      if (active) void onSwitchSessionAccount(active.id, provider, accountId);
    },
    [active?.id, onSwitchSessionAccount],
  );

  const onUsageLimitResumeAtReset = useCallback((sessionId: string, enabled: boolean) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.usageLimit
          ? {
              ...session,
              usageLimit: { ...session.usageLimit, resumeAtReset: enabled },
            }
          : session,
      ),
    );
  }, []);

  const onUsageLimitResume = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session?.usageLimit || session.busy) return;
      onUsageLimitDismiss(sessionId);
      onSubmit(sessionId, RESUME_PROMPT);
    },
    [onSubmit, onUsageLimitDismiss],
  );

  return {
    onUsageLimitDismiss,
    onSwitchSessionAccount,
    onSelectProviderAccount,
    onUsageLimitResumeAtReset,
    onUsageLimitResume,
  };
}
