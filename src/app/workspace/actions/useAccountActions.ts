import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Session } from "../../../features/sessions/model/session";
import { type ProviderAccountProvider, providerAccountExists, providerAccountLabel } from "../../../features/providers/model/providerAccounts";
import { switchSessionAccount } from "../../../features/sessions/model/accountSwitch";
import { transferProviderSession } from "../../../platform/tauri/providerSessionTransfer";
import { bindHarnessSession, forgetHarnessSession, type HarnessEvent } from "../../../integrations/harness";
import { CONTINUE_PROMPT } from "../../../features/sessions/model/inFlight";
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
      if (isMovingPane(sessionId)) return false;
      if (!providerAccountExists(provider, accountId)) return false;
      const result = await switchSessionAccount(sessionId, provider, accountId, {
        transfer: transferProviderSession,
        forget: forgetHarnessSession,
        bind: bindHarnessSession,
        latest: (id) => sessionsRef.current.find((s) => s.id === id),
        label: providerAccountLabel,
        removing: (id) => removingSessionIds.current.has(id),
      });
      const say = (text: string) => {
        enqueueHarnessEvent(sessionId, { type: "status", text });
        flushHarnessEvents();
      };
      if (result.kind === "refused") {
        say(result.status);
        return false;
      }
      if (result.kind !== "switched") {
        if (result.kind === "noop") {
          promptProviderAccountSignIn(sessionId, provider, accountId);
        }
        return result.kind === "noop";
      }
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? result.update(s) : s)));
      if (result.status) say(result.status);
      promptProviderAccountSignIn(sessionId, provider, accountId);
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents, promptProviderAccountSignIn],
  );

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
      onSubmit(sessionId, CONTINUE_PROMPT);
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
