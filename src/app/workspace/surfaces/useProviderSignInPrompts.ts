import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { HarnessId, Session } from "../../../features/sessions/model/session";
import {
  providerAccountExists,
  sessionProviderAccountId,
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../../features/providers/model/providerAccounts";
import { loadFreshRateLimits } from "../../../features/providers/model/rateLimitsCache";
import { providerAccountSignedOut } from "../../../features/providers/model/accountUsage";
import { supportsHarnessLogin } from "../../../integrations/harness/core/authSupport";
import { latestTurnNeedsHarnessLogin } from "../../../integrations/harness";
import { providerSignInRequestKey } from "../helpers/sessionHelpers";

export interface ProviderSignInRequest {
  key: string;
  sessionId: string;
  harness: HarnessId;
  accountId?: string;
}

export interface ProviderAccountRecovery {
  sessionId: string;
  provider: ProviderAccountProvider;
}

export interface ProviderSignInPromptsDeps {
  active: Session | undefined;
  sessions: Session[];
  sessionsRef: MutableRefObject<Session[]>;
}

// Sign-in and account-recovery prompts for the active session. Called where the
// active-session sign-in memo used to sit (after `active` is derived).
export function useProviderSignInPrompts({ active, sessions, sessionsRef }: ProviderSignInPromptsDeps) {
  const [providerAccountRecovery, setProviderAccountRecovery] = useState<ProviderAccountRecovery | null>(null);
  const [providerSignInRequest, setProviderSignInRequest] = useState<ProviderSignInRequest | null>(null);
  const seenProviderSignInRequestsRef = useRef<Set<string> | null>(null);
  const seenProviderSignInRequests =
    seenProviderSignInRequestsRef.current ??
    (seenProviderSignInRequestsRef.current = new Set(
      sessions.flatMap((session) => {
        if (
          !supportsHarnessLogin(session.harness) ||
          !latestTurnNeedsHarnessLogin(session.blocks)
        ) {
          return [];
        }
        return [providerSignInRequestKey(session)];
      }),
    ));

  const activeProviderSignInRequest = useMemo(() => {
    if (
      !active ||
      !supportsHarnessLogin(active.harness) ||
      !latestTurnNeedsHarnessLogin(active.blocks)
    ) {
      return null;
    }
    if (
      supportsProviderAccounts(active.harness) &&
      !providerAccountExists(active.harness, sessionProviderAccountId(active.harness, active))
    ) {
      return null;
    }
    return {
      key: providerSignInRequestKey(active),
      sessionId: active.id,
      harness: active.harness,
      accountId: supportsProviderAccounts(active.harness)
        ? sessionProviderAccountId(active.harness, active)
        : undefined,
    };
  }, [active]);
  useEffect(() => {
    if (!activeProviderSignInRequest) return;
    if (seenProviderSignInRequests.has(activeProviderSignInRequest.key)) {
      return;
    }
    seenProviderSignInRequests.add(activeProviderSignInRequest.key);
    setProviderSignInRequest(activeProviderSignInRequest);
  }, [activeProviderSignInRequest, seenProviderSignInRequests]);
  useEffect(() => {
    if (providerSignInRequest && active?.id !== providerSignInRequest.sessionId) {
      setProviderSignInRequest(null);
    }
  }, [active?.id, providerSignInRequest]);

  // Choosing a signed-out or expired account opens its sign-in instead of
  // letting the next turn fail. Re-checked after the read: the user may have
  // moved to another account while it ran.
  const promptProviderAccountSignIn = useCallback(
    (sessionId: string, provider: ProviderAccountProvider, accountId: string) => {
      void loadFreshRateLimits(provider, accountId, 60_000).then((limits) => {
        if (!providerAccountSignedOut(limits)) return;
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !session ||
          session.harness !== provider ||
          sessionProviderAccountId(provider, session) !== accountId
        ) {
          return;
        }
        setProviderSignInRequest({
          key: `${sessionId}:account:${provider}:${accountId}:${Date.now()}`,
          sessionId,
          harness: provider,
          accountId,
        });
      });
    },
    [],
  );

  return {
    providerAccountRecovery,
    setProviderAccountRecovery,
    providerSignInRequest,
    setProviderSignInRequest,
    promptProviderAccountSignIn,
  };
}
