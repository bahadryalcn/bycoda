import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  loadRemoteBlock,
  loadRemoteHistoryPage,
  loadRemoteSession,
  sessionAccessForMachine,
} from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { sessionExecutionClient } from "../../connections/model/sessionExecutionClient";
import { getGroupLockView, subscribeGroupLock } from "../../group-lock/model/groupLock";
import { assertReferenceProjectVisible, resolveLocalSessionReference } from "../model/localSessionNavigation";
import type { Session } from "../model/session";
import { t } from "../../../shared/i18n";

type ReadState = {
  key: string;
  privacy: ReturnType<typeof getGroupLockView>;
  snapshot?: HostSession;
  loading: boolean;
  error?: string;
  historyLoading?: boolean;
  historyError?: string;
};
type Reader = {
  loadHistory: () => Promise<number | void>;
  loadBlock: (id: string) => Promise<void>;
};

/** A worker viewer reads only. It never mounts queue, continuation or draft owners. */
export function useReadOnlyHostSession(shell: Session, visible: boolean) {
  const binding = hostSessionBinding(shell);
  const privacy = useSyncExternalStore(subscribeGroupLock, getGroupLockView);
  const key = JSON.stringify(binding && [binding.machineId, binding.environmentId, binding.projectId, binding.sessionId]);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<ReadState>({ key, privacy, loading: true });
  const retained = useRef(state);
  retained.current = state;
  const reader = useRef<Reader | null>(null);
  useEffect(() => {
    if (!binding || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const previous = retained.current;
    let snapshot = previous.key === key && previous.privacy === privacy ? previous.snapshot : undefined;
    let historyLoading = false;
    const current = () => !cancelled && getGroupLockView() === privacy;
    const publish = (patch: Partial<ReadState>) => {
      if (!current()) return;
      setState((previous) => ({ ...previous, key, privacy, ...patch }));
    };
    const unavailable = () => new Error(t("This local conversation is unavailable or inaccessible."));
    publish({ snapshot, loading: !snapshot, error: undefined, historyLoading: false, historyError: undefined });
    const connect = async () => {
      const resolved = await resolveLocalSessionReference({ locator: {
        kind: "host", environmentId: binding.environmentId, sessionId: binding.sessionId,
      } });
      if (!current()) return;
      const host = resolved.host;
      if (!host || host.machine.id !== binding.machineId || host.project.id !== binding.projectId)
        throw unavailable();
      const client = sessionExecutionClient(binding.environmentId,
        sessionAccessForMachine(binding.machineId, false, true, binding.environmentId));
      const validate = (value: HostSession) => {
        if (value.session.id !== binding.sessionId || value.projectId !== binding.projectId)
          throw unavailable();
        assertReferenceProjectVisible(resolved.cwd);
      };
      reader.current = {
        loadHistory: async () => {
          const original = snapshot;
          if (!current() || !original || historyLoading || original.history?.before === undefined) return;
          historyLoading = true;
          publish({ historyLoading: true, historyError: undefined });
          try {
            const next = await loadRemoteHistoryPage(binding.machineId, binding.sessionId,
              original, () => current() && snapshot === original, client);
            if (!current() || snapshot !== original || !next) return;
            validate(next);
            snapshot = next;
            publish({ snapshot });
            return next.session.blocks.length - original.session.blocks.length;
          } catch (error) {
            publish({ historyError: String(error).replace(/^Error: /, "") });
          } finally {
            historyLoading = false;
            publish({ historyLoading: false });
          }
        },
        loadBlock: async (id) => {
          const original = snapshot;
          if (!current() || !original) return;
          const block = await loadRemoteBlock(binding.machineId, binding.sessionId, id, original.revision, client);
          if (!current() || !block || snapshot?.revision !== original.revision) return;
          assertReferenceProjectVisible(resolved.cwd);
          snapshot = { ...snapshot, session: { ...snapshot.session,
            blocks: snapshot.session.blocks.map((entry) => entry.id === id ? block : entry) } };
          publish({ snapshot });
        },
      };
      const poll = async () => {
        if (!current()) return;
        try {
          if (!historyLoading) {
            const original = snapshot;
            const next = await loadRemoteSession(binding.machineId, binding.sessionId, original, {
              pages: true, executionClient: client, isCurrent: current,
            });
            if (!current()) return;
            validate(next);
            // A bounded older-page read can finish during this tail request.
            if (snapshot === original || snapshot?.revision !== next.revision) snapshot = next;
            publish({ snapshot, loading: false, error: undefined });
          }
        } catch (error) {
          publish({ loading: false, error: String(error).replace(/^Error: /, "") });
        } finally {
          if (current()) timer = setTimeout(() => { void poll(); }, 2500);
        }
      };
      await poll();
    };
    void connect().catch((error) => publish({ loading: false, error: String(error).replace(/^Error: /, "") }));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      reader.current = null;
    };
  }, [key, privacy, visible, refresh]);
  const valid = state.key === key && state.privacy === privacy;
  const snapshot = valid ? state.snapshot : undefined;
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  const loadHistory = useCallback(() => reader.current?.loadHistory() ?? Promise.resolve(), []);
  const loadBlock = useCallback((id: string) => reader.current?.loadBlock(id) ?? Promise.resolve(), []);
  return {
    session: {
      ...shell, ...(snapshot?.session ?? {}), id: shell.id, hostBinding: binding,
      blocks: snapshot?.session.blocks ?? [], busy: snapshot?.status === "running",
      historyLoading: !snapshot && (!valid || state.loading),
    } as Session,
    error: valid ? state.error : undefined,
    retry,
    remoteHistoryHasMore: snapshot?.history?.before !== undefined,
    remoteHistoryLoading: !!(valid && state.historyLoading),
    remoteHistoryError: valid ? state.historyError : undefined,
    onLoadRemoteHistory: loadHistory,
    onLoadRemoteBlock: loadBlock,
  };
}
