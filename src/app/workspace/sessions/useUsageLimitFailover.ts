import { useEffect, useRef, type MutableRefObject } from "react";
import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { loadLocalModelOrder } from "../../../features/model-routing/public/helpers";
import {
  providerAccountLabel,
  providerAccounts,
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../../features/providers/model/providerAccounts";
import { loadFreshRateLimits } from "../../../features/providers/model/rateLimitsCache";
import { RESUME_PROMPT } from "../../../features/sessions/model/inFlight";
import { modelDisplayName } from "../../../features/sessions/model/modelDisplayName";
import type { HarnessId, Session, UsageLimit } from "../../../features/sessions/model/session";
import {
  LimitedAccounts,
  failoverAccountKey,
  pickAccountFailover,
  pickOrderFailover,
  type FailoverTarget,
} from "../../../features/sessions/model/usageLimitFailover";
import { loadUsageLimitFailover } from "../../../features/settings/public/settings";
import type { HarnessEvent } from "../../../integrations/harness";
import { t } from "../../../shared/i18n";

/** Shared with the footer: providers rate-limit the quota endpoint. */
const LIMITS_MAX_AGE_MS = 60_000;

export interface UsageLimitFailoverDeps {
  sessions: Session[];
  sessionsRef: MutableRefObject<Session[]>;
  movingSessionIds: MutableRefObject<Set<string>>;
  windowTransferPendingRef: MutableRefObject<boolean>;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
  onModelChange: (
    sessionId: string,
    harness: HarnessId,
    model: string,
    accountId?: string,
  ) => Promise<void>;
  onSubmit: (sessionId: string, text: string) => void;
}

function accountOf(session: Pick<Session, "harness" | "providerAccountId" | "providerSessionId">) {
  return supportsProviderAccounts(session.harness)
    ? sessionProviderAccountId(session.harness, session)
    : undefined;
}

function targetLabel(target: FailoverTarget): string {
  const model = modelDisplayName(target.model, target.harness);
  return supportsProviderAccounts(target.harness)
    ? `${providerAccountLabel(target.harness, target.providerAccountId)} · ${model}`
    : model;
}

/**
 * When the owner turned on usage-limit failover in Chat settings, a local chat that a
 * provider stops at its usage limit switches to another account or the next model of the
 * Host's order and continues there. Only limits that arrive while the app runs count:
 * limits restored from an earlier launch keep waiting for their reset.
 */
export function useUsageLimitFailover({
  sessions,
  sessionsRef,
  movingSessionIds,
  windowTransferPendingRef,
  enqueueHarnessEvent,
  flushHarnessEvents,
  onModelChange,
  onSubmit,
}: UsageLimitFailoverDeps): void {
  const seenRef = useRef<WeakSet<UsageLimit> | null>(null);
  const limitedRef = useRef<LimitedAccounts | null>(null);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- follows usage limits that provider processes report into session state; the harness layer that sees the turn end cannot reach these app actions.
  useEffect(() => {
    if (!seenRef.current) {
      // The first pass only records limits restored from storage.
      seenRef.current = new WeakSet(sessions.flatMap((s) => (s.usageLimit ? [s.usageLimit] : [])));
      return;
    }
    limitedRef.current ??= new LimitedAccounts();
    for (const session of sessions) {
      const limit = session.usageLimit;
      // A turn still ending may yet fall back on its own; wait until it is idle.
      if (!limit || session.busy || seenRef.current.has(limit)) continue;
      seenRef.current.add(limit);
      limitedRef.current.hold(
        failoverAccountKey(session.harness, accountOf(session)),
        Date.now(),
        limit.resetsAt,
      );
      const mode = loadUsageLimitFailover();
      if (mode === "off" || hostSessionBinding(session)) continue;
      if (windowTransferPendingRef.current || movingSessionIds.current.has(session.id)) continue;
      const actions = {
        sessionsRef,
        enqueueHarnessEvent,
        flushHarnessEvents,
        onModelChange,
        onSubmit,
      };
      void runFailover(actions, limitedRef.current, session, limit, mode).catch(
        (error: unknown) => {
          console.warn("Usage limit failover failed", error);
        },
      );
    }
  }, [
    sessions,
    sessionsRef,
    movingSessionIds,
    windowTransferPendingRef,
    enqueueHarnessEvent,
    flushHarnessEvents,
    onModelChange,
    onSubmit,
  ]);
}

async function runFailover(
  deps: Pick<
    UsageLimitFailoverDeps,
    "sessionsRef" | "enqueueHarnessEvent" | "flushHarnessEvents" | "onModelChange" | "onSubmit"
  >,
  limited: LimitedAccounts,
  session: Session,
  limit: UsageLimit,
  mode: "account" | "order",
): Promise<void> {
  const { sessionsRef, enqueueHarnessEvent, flushHarnessEvents, onModelChange, onSubmit } = deps;
  const say = (text: string) => {
    enqueueHarnessEvent(session.id, { type: "status", text });
    flushHarnessEvents();
  };
  const isLimited = (key: string) => limited.has(key, Date.now());
  let target: FailoverTarget | undefined;
  if (mode === "account") {
    const harness = session.harness;
    if (supportsProviderAccounts(harness)) {
      const current = accountOf(session);
      target = await pickAccountFailover({
        harness,
        model: session.model,
        accountIds: providerAccounts(harness)
          .map((account) => account.id)
          .filter((id) => id !== current),
        limited: isLimited,
        readLimits: (accountId) => loadFreshRateLimits(harness, accountId, LIMITS_MAX_AGE_MS),
      });
    }
  } else {
    const order = await loadLocalModelOrder();
    target = order ? pickOrderFailover({ ...order, limited: isLimited }) : undefined;
  }
  const now = sessionsRef.current.find((entry) => entry.id === session.id);
  // The owner acted on the notice meanwhile, or the chat moved on: theirs wins.
  if (!now || now.usageLimit !== limit || now.busy) return;
  if (!target) {
    say(
      mode === "account"
        ? t("No other account has quota left. Waiting for the usage limit to reset.")
        : t("No model in the model order has quota left. Waiting for the usage limit to reset."),
    );
    return;
  }
  say(t("Usage limit reached. Continuing on {p0}.", { p0: targetLabel(target) }));
  await onModelChange(session.id, target.harness, target.model, target.providerAccountId);
  const switched = sessionsRef.current.find((entry) => entry.id === session.id);
  // A refused switch already said why in the transcript; never resend on the limited account.
  // The model id is normalized by the pick, so provider and account identify the switch.
  if (
    !switched ||
    switched.busy ||
    switched.harness !== target.harness ||
    failoverAccountKey(switched.harness, accountOf(switched)) ===
      failoverAccountKey(session.harness, accountOf(session)) ||
    (target.providerAccountId !== undefined && accountOf(switched) !== target.providerAccountId)
  )
    return;
  onSubmit(session.id, RESUME_PROMPT);
}
