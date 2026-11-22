import {
  classifyFailureLifetime,
  useGracedFailure,
} from "../../connections/public/transientFailure";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  loadRemoteBlock,
  loadRemoteHistoryPage,
  loadRemoteSession,
  machineSupportsLazyHistory,
  sessionAccessForMachine,
} from "../../connections/public/connections";
import type { HostSession } from "../../connections";
import { type HostSessionBinding } from "../../connections/public/sessionExecutionBinding";
import { useReloadOnMachineReconnect } from "../../connections/public/useReloadOnReconnect";
import { useHostSessionBinding } from "../../connections/public/useHostSessionBinding";
import { sessionExecutionClient } from "../../connections/public/sessionExecutionClient";
import { getGroupLockView, subscribeGroupLock } from "../../group-lock/model/groupLock";
import {
  assertReferenceProjectVisible,
  resolveLocalSessionReference,
} from "../model/localSessionNavigation";
import type { Session } from "../model/session";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t } from "../../../shared/i18n";

type ReadState = {
  key: string;
  privacy: ReturnType<typeof getGroupLockView>;
  snapshot?: HostSession;
  loading: boolean;
  error?: unknown;
  historyLoading?: boolean;
  historyError?: unknown;
};
type Reader = {
  loadHistory: () => Promise<number | void>;
  loadBlock: (id: string) => Promise<void>;
};

type ReaderStart = {
  binding: HostSessionBinding;
  key: string;
  privacy: ReturnType<typeof getGroupLockView>;
  previous: ReadState;
  reader: { current: Reader | null };
  retryRead: { current: (() => Promise<void>) | null };
  setState: Dispatch<SetStateAction<ReadState>>;
};

const RUNNING_POLL_MS = 2500;
const IDLE_POLL_MS = 10_000;
const MAX_POLL_MS = 60_000;

/** A running session is checked often, an idle one rarely, and failures back off up to a minute. */
export function readOnlyPollDelay(running: boolean, failures: number): number {
  if (failures > 0) return Math.min(MAX_POLL_MS, RUNNING_POLL_MS * 2 ** failures);
  return running ? RUNNING_POLL_MS : IDLE_POLL_MS;
}

/** Connects to the Host session and polls it until the returned cleanup runs. */
function startReadOnlyReader({
  binding,
  key,
  privacy,
  previous,
  reader,
  retryRead,
  setState,
}: ReaderStart) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onVisibility: (() => void) | undefined;
  let inFlight = false;
  let failures = 0;
  let snapshot =
    previous.key === key && previous.privacy === privacy ? previous.snapshot : undefined;
  let historyLoading = false;
  const current = () => !cancelled && getGroupLockView() === privacy;
  const publish = (patch: Partial<ReadState>) => {
    if (!current()) return;
    setState((previous) => {
      if (
        previous.key === key &&
        previous.privacy === privacy &&
        (Object.keys(patch) as (keyof ReadState)[]).every((field) =>
          Object.is(previous[field], patch[field]),
        )
      )
        return previous;
      return { ...previous, key, privacy, ...patch };
    });
  };
  const unavailable = () => new Error(t("This local conversation is unavailable or inaccessible."));
  publish({
    snapshot,
    loading: !snapshot,
    error: undefined,
    historyLoading: false,
    historyError: undefined,
  });
  const connect = async () => {
    const resolved = await resolveLocalSessionReference({
      locator: {
        kind: "host",
        environmentId: binding.environmentId,
        sessionId: binding.sessionId,
      },
    });
    if (!current()) return;
    const host = resolved.host;
    if (!host || host.machine.id !== binding.machineId || host.project.id !== binding.projectId)
      throw unavailable();
    const client = sessionExecutionClient(
      binding.environmentId,
      sessionAccessForMachine(binding.machineId, false, true, binding.environmentId),
    );
    const validate = (value: HostSession) => {
      if (value.session.id !== binding.sessionId || value.projectId !== binding.projectId)
        throw unavailable();
      assertReferenceProjectVisible(resolved.cwd);
    };
    reader.current = {
      loadHistory: async () => {
        const original = snapshot;
        if (!current() || !original || historyLoading || original.history?.before === undefined)
          return;
        historyLoading = true;
        publish({ historyLoading: true });
        try {
          const next = await loadRemoteHistoryPage(
            binding.machineId,
            binding.sessionId,
            original,
            () => current() && snapshot === original,
            client,
          );
          if (!current() || snapshot !== original) return 0;
          if (!next) {
            publish({ historyError: undefined });
            return 0;
          }
          validate(next);
          snapshot = next;
          publish({ snapshot, historyError: undefined });
          return next.session.blocks.length - original.session.blocks.length;
        } catch (error) {
          if (snapshot === original) publish({ historyError: error });
          // Nothing was added: the transcript window stays where it is.
          return 0;
        } finally {
          historyLoading = false;
          publish({ historyLoading: false });
        }
      },
      loadBlock: async (id) => {
        const original = snapshot;
        if (!current() || !original) return;
        const block = await loadRemoteBlock(
          binding.machineId,
          binding.sessionId,
          id,
          original.revision,
          client,
        );
        if (!current() || !block || snapshot?.revision !== original.revision) return;
        assertReferenceProjectVisible(resolved.cwd);
        snapshot = {
          ...snapshot,
          session: {
            ...snapshot.session,
            blocks: snapshot.session.blocks.map((entry) => (entry.id === id ? block : entry)),
          },
        };
        publish({ snapshot });
      },
    };
    // A hidden window is not read; the visibility listener resumes with one immediate poll.
    const schedule = () => {
      if (!current() || document.hidden) return;
      timer = setTimeout(
        () => {
          // Hidden since this timer was armed: the visibility listener resumes with one poll.
          if (document.hidden) return;
          void poll();
        },
        readOnlyPollDelay(snapshot?.status === "running", failures),
      );
    };
    const poll = async () => {
      if (!current() || inFlight) return;
      inFlight = true;
      if (timer) clearTimeout(timer);
      try {
        if (!historyLoading) {
          const original = snapshot;
          const next = await loadRemoteSession(binding.machineId, binding.sessionId, original, {
            pages: true,
            // Capable Hosts answer an unchanged transcript with a revision check, not a tail page.
            partialHistory: machineSupportsLazyHistory(binding.machineId),
            executionClient: client,
            isCurrent: current,
          });
          if (!current()) return;
          validate(next);
          // A bounded older-page read can finish during this tail request.
          if (snapshot === original || snapshot?.revision !== next.revision) snapshot = next;
          failures = 0;
          publish({ snapshot, loading: false, error: undefined });
        }
      } catch (error) {
        failures += 1;
        publish({ loading: false, error });
      } finally {
        inFlight = false;
        schedule();
      }
    };
    retryRead.current = poll;
    onVisibility = () => {
      if (document.hidden || !current() || inFlight) return;
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Loaded content stays as it is while hidden; only a first read is worth a hidden request.
    if (document.hidden && snapshot) return;
    await poll();
  };
  const tryConnect = () =>
    connect().catch((error: unknown) => publish({ loading: false, error }));
  retryRead.current = tryConnect;
  void tryConnect();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    reader.current = null;
    retryRead.current = null;
  };
}

/** A worker viewer reads only. It never mounts queue, continuation or draft owners. */
export function useReadOnlyHostSession(shell: Session, visible: boolean) {
  const binding = useHostSessionBinding(shell);
  const privacy = useSyncExternalStore(subscribeGroupLock, getGroupLockView);
  const key = JSON.stringify(
    binding && [binding.machineId, binding.environmentId, binding.projectId, binding.sessionId],
  );
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<ReadState>({ key, privacy, loading: true });
  const latestState = useStableCallback(() => state);
  const reader = useRef<Reader | null>(null);
  const retryRead = useRef<(() => Promise<void>) | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Owns the poll and read handles for the visible session and current privacy view.
  useEffect(() => {
    if (!binding || !visible) return;
    return startReadOnlyReader({
      binding,
      key,
      privacy,
      previous: latestState(),
      reader,
      retryRead,
      setState,
    });
  }, [key, privacy, visible, refresh, latestState]);
  const valid = state.key === key && state.privacy === privacy;
  const snapshot = valid ? state.snapshot : undefined;
  const retry = () => setRefresh((value) => value + 1);
  const retrySession = () => {
    if (!document.hidden) return retryRead.current?.();
  };
  const loadHistory = () => reader.current?.loadHistory() ?? Promise.resolve();
  const retryHistory = async () => {
    if (!document.hidden) await loadHistory();
  };
  const readError = visible && valid ? state.error : undefined;
  const { visibleError, pending } = useGracedFailure({
    error: readError,
    retry: retrySession,
    scope: key,
  });
  const { visibleError: historyError, pending: historyPending } = useGracedFailure({
    error: visible && valid && snapshot?.history?.before !== undefined ? state.historyError : undefined,
    retry: retryHistory,
    scope: key,
  });
  useReloadOnMachineReconnect(binding?.environmentId, retrySession, {
    active: readError != null && classifyFailureLifetime(readError) === "transient",
  });
  const loadBlock = (id: string) => reader.current?.loadBlock(id) ?? Promise.resolve();
  return {
    session: {
      ...shell,
      ...snapshot?.session,
      id: shell.id,
      hostBinding: binding,
      blocks: snapshot?.session.blocks ?? [],
      busy: snapshot?.status === "running",
      historyLoading: !snapshot && (!valid || state.loading || pending),
    } as Session,
    error: visibleError,
    retry,
    remoteHistoryHasMore: snapshot?.history?.before !== undefined,
    remoteHistoryLoading: !!(valid && state.historyLoading) || historyPending,
    remoteHistoryError: historyError,
    onLoadRemoteHistory: loadHistory,
    onLoadRemoteBlock: loadBlock,
  };
}
