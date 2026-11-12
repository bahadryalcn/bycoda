import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../../shared/lib/errors";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { listMessageThreads } from "../model/messagingApi";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import type { MessageThread, MessagingAccount } from "../model/messagingTypes";
import {
  accountFailures,
  applyAccountResult,
  mergeThreads,
  patchAccountThread,
  type AccountThreads,
  type AccountThreadsResult,
} from "../model/messageThreads";

export const MESSAGES_REFRESH_INTERVAL_MS = 60_000;

// Last-good threads per account survive tab switches for this app run.
const cache = new Map<string, AccountThreads>();
let lastLoadedAt: number | null = null;

function shareThreads(previous: MessageThread[], incoming: MessageThread[]): MessageThread[] {
  const byId = new Map(previous.map((thread) => [thread.id, thread]));
  const shared = incoming.map((thread) => {
    const old = byId.get(thread.id);
    return old &&
      old.accountId === thread.accountId &&
      old.provider === thread.provider &&
      old.title === thread.title &&
      old.preview === thread.preview &&
      old.updatedAt === thread.updatedAt &&
      old.unread === thread.unread &&
      old.url === thread.url &&
      old.participants.length === thread.participants.length &&
      old.participants.every((participant, index) => participant === thread.participants[index])
      ? old
      : thread;
  });
  return previous.length === shared.length &&
    shared.every((thread, index) => thread === previous[index])
    ? previous
    : shared;
}

function loadAccount(account: MessagingAccount): Promise<AccountThreadsResult> {
  return Promise.resolve()
    .then(() => listMessageThreads(account.id))
    .then(
      (threads): AccountThreadsResult =>
        Array.isArray(threads)
          ? { ok: true, threads }
          : { ok: false, error: "The account returned an unexpected response." },
      (error: unknown): AccountThreadsResult => ({ ok: false, error: errorText(error) }),
    );
}

/**
 * Threads of every connected account, loaded in parallel and merged newest first. Each
 * account lands on its own; a failed account keeps its last-good threads and reports its
 * error. Refreshes never overlap; `active` (panel shown, window focused) enables the
 * periodic refresh, nothing polls otherwise.
 */
export function useMessageThreads(accounts: readonly MessagingAccount[], active: boolean) {
  const connected = useMemo(() => accounts.filter((account) => account.connected), [accounts]);
  const identity = connected.map((account) => `${account.id}:${account.updatedAt}`).join("\n");
  const connectedRef = useRef(connected);
  const [byAccount, setByAccount] = useState<Record<string, AccountThreads>>(() =>
    Object.fromEntries(cache),
  );
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);

  /** `queueIfBusy` is for account changes; manual and timed refreshes never stack. */
  const refresh = useCallback((queueIfBusy = false) => {
    const settle = (account: MessagingAccount, result: AccountThreadsResult) => {
      const previous = cache.get(account.id);
      const applied = applyAccountResult(previous, result);
      const threads = previous ? shareThreads(previous.threads, applied.threads) : applied.threads;
      const next =
        previous &&
        threads === previous.threads &&
        applied.error === previous.error &&
        applied.loaded === previous.loaded
          ? previous
          : { ...applied, threads };
      cache.set(account.id, next);
      if (alive.current)
        setByAccount((previous) =>
          previous[account.id] === next ? previous : { ...previous, [account.id]: next },
        );
    };
    const run = (queue: boolean) => {
      if (inFlight.current) {
        if (queue) queued.current = true;
        return;
      }
      const targets = connectedRef.current;
      if (targets.length === 0) return;
      inFlight.current = true;
      queued.current = false;
      setLoading(true);
      Promise.all(
        targets.map((account) => loadAccount(account).then((result) => settle(account, result))),
      )
        .catch((error: unknown) => console.error("Messages refresh failed:", error))
        .finally(() => {
          inFlight.current = false;
          lastLoadedAt = monotonicNow();
          if (alive.current) setLoading(false);
          // An account added mid-flight still needs its first load.
          if (queued.current && alive.current) run(true);
        });
    };
    run(queueIfBusy);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  // First load and every change to the connected account set.
  useEffect(() => {
    refresh(true);
  }, [identity, refresh]);

  useEffect(() => {
    if (!active) return;
    if (lastLoadedAt != null && elapsedSince(lastLoadedAt) >= MESSAGES_REFRESH_INTERVAL_MS)
      refresh();
    const timer = window.setInterval(() => refresh(), MESSAGES_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const patchThread = useCallback(
    (
      thread: MessageThread,
      patch: Partial<Pick<MessageThread, "preview" | "updatedAt" | "unread">>,
    ) => {
      const next = patchAccountThread(cache.get(thread.accountId), thread.id, patch);
      if (!next) return;
      cache.set(thread.accountId, next);
      if (alive.current) setByAccount((previous) => ({ ...previous, [thread.accountId]: next }));
    },
    [],
  );

  const merged = useMemo(() => mergeThreads(connected, byAccount), [connected, byAccount]);
  const threads = useStableValue(
    merged,
    (previous, next) =>
      previous.length === next.length && previous.every((thread, index) => thread === next[index]),
  );
  const failures = useMemo(() => accountFailures(connected, byAccount), [connected, byAccount]);
  const loaded = connected.every(
    (account) => byAccount[account.id]?.loaded || byAccount[account.id]?.error,
  );
  const manualRefresh = useCallback(() => refresh(), [refresh]);
  return { threads, failures, loading, loaded, refresh: manualRefresh, patchThread };
}
