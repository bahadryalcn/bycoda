import { isTauri } from "@tauri-apps/api/core";
import { registerAssistantDraftFlusher } from "../../model/assistantDraftFlush";
import {
  readAssistantNativeDraft,
  writeAssistantNativeDraft,
  type AssistantDraftBackup,
} from "../../model/assistantNativeSend";
import { listenWindow } from "../../../../platform/tauri/listenWindow";
import { useAssistantControlSource } from "../../model/useAssistantControlSource";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantMessage,
  AssistantSnapshot,
  AssistantThread,
} from "../../../../shared/model/host-contracts/assistant";
import { type ConfirmRequest } from "../../../../shared/ui/ConfirmDialog";
import { visibleAssistantMessages, type AssistantPrivacyScope } from "../../model/assistantPrivacy";
import { type OwnerRequest, type Project } from "./assistantRoomHelpers";

export type ConversationPanelProps = {
  request: OwnerRequest;
  environmentId?: string;
  snapshot: AssistantSnapshot;
  source: AssistantSnapshot;
  privacy: AssistantPrivacyScope;
  canSeeProject: (id: string) => boolean;
  projectId: string;
  projects: readonly Project[];
  sessionId?: string;
  query: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onJob: (id: string) => void;
  isAppQuitting: () => boolean;
};

export type ConversationPanelState = ReturnType<typeof useConversationPanelState>;

export const nativeUnsavedConversationDrafts = new Map<string, string>();
let unsavedConversationDrafts: Record<string, string> | undefined;

export function useConversationPanelState({
  request,
  environmentId,
  snapshot,
  source,
  privacy,
  canSeeProject,
  projectId,
  projects,
}: ConversationPanelProps) {
  const [assistantRequest] = useState(() => request);
  const [retainedThreadId, setThreadId] = useState(
    snapshot.threads.find((thread) => !thread.projectId)?.id ?? snapshot.threads[0]?.id ?? "",
  );
  const threadId = snapshot.threads.some((thread) => thread.id === retainedThreadId)
    ? retainedThreadId
    : "";
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const currentScope = useRef({ snapshot, source, privacy, canSeeProject, environmentId });
  currentScope.current = { snapshot, source, privacy, canSeeProject, environmentId };
  function threadVisible(id: string) {
    const thread = currentScope.current.snapshot.threads.find((thread) => thread.id === id);
    return !!thread && (!thread.projectId || currentScope.current.canSeeProject(thread.projectId));
  }
  const roomSourceStatus = useAssistantControlSource(
    threadId && threadVisible(threadId) ? threadId : undefined,
    environmentId,
  );
  function messageVisible(message: AssistantMessage) {
    const current = currentScope.current;
    return (
      threadVisible(message.threadId) &&
      visibleAssistantMessages([message], current.source, current.privacy).length === 1
    );
  }
  const [threadUpdates, setThreadUpdates] = useState<Record<string, AssistantThread>>({});
  const threadUpdatesRef = useRef(threadUpdates);
  threadUpdatesRef.current = threadUpdates;
  function newerThread(left: AssistantThread | undefined, right: AssistantThread | undefined) {
    if (!left) return right;
    if (!right) return left;
    return right.version > left.version ||
      (right.version === left.version &&
        (right.summaryState?.updatedAt ?? 0) > (left.summaryState?.updatedAt ?? 0))
      ? right
      : left;
  }
  function currentThreadFor(id: string) {
    return newerThread(
      currentScope.current.snapshot.threads.find((thread) => thread.id === id),
      threadUpdatesRef.current[id],
    );
  }
  function summaryScopeVisible(id: string) {
    const thread = currentThreadFor(id);
    return (
      threadVisible(id) &&
      !!thread &&
      (!thread.summaryProof ||
        thread.summaryProof.projectIds.every(currentScope.current.canSeeProject))
    );
  }
  function mergeThread(
    thread: AssistantThread,
    expectedId: string,
    expectedEnvironment: string | undefined,
  ) {
    if (
      !alive.current ||
      thread.id !== expectedId ||
      currentScope.current.environmentId !== expectedEnvironment ||
      !threadVisible(expectedId)
    )
      return;
    setThreadUpdates((current) => ({
      ...current,
      [expectedId]: newerThread(current[expectedId], thread)!,
    }));
  }
  const initialProject = projects.some((item) => (item.id ?? item.path) === projectId)
    ? projectId
    : (projects[0]?.id ?? projects[0]?.path ?? "");
  const [scope, setScope] = useState("global");
  const [project, setProject] = useState(initialProject);
  const [messages, setMessages] = useState<Record<string, AssistantMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    if (isTauri()) return {};
    if (unsavedConversationDrafts) return { ...unsavedConversationDrafts };
    try {
      return JSON.parse(localStorage.getItem("bycoda.assistant.thread-drafts") ?? "{}");
    } catch {
      return {};
    }
  });
  const draftsRef = useRef(drafts);
  const [initialSavedDrafts] = useState<string | null>(() =>
    unsavedConversationDrafts ? null : JSON.stringify(drafts),
  );
  const savedDrafts = useRef(initialSavedDrafts);
  const maximumDraftTimer = useRef<number | undefined>(undefined);
  const [draftSaveError, setDraftSaveError] = useState(!isTauri() && !!unsavedConversationDrafts);
  const [operationPending, setPending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  /** Threads whose first page of messages has finished loading (successfully or not). */
  const [loadedThreads, setLoadedThreads] = useState<Record<string, boolean>>({});
  const messageLoadSequence = useRef(0);
  const pending = operationPending || loadingMessages;
  const [clearing, setClearing] = useState(false);
  const [threadMenu, setThreadMenu] = useState<HTMLElement | null>(null);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const summaryPending = useRef(false);
  const [summaryError, setSummaryError] = useState<{ threadId: string; text: string } | null>(null);
  const clearingRef = useRef(false);
  const searchEpoch = useRef(0);
  const [errorState, setErrorState] = useState({ key: privacy.key, text: "" });
  const error = errorState.key === privacy.key ? errorState.text : "";
  function setError(text: string) {
    setErrorState({ key: privacy.key, text });
  }
  const [confirm, setConfirmState] = useState<ConfirmRequest | null>(null);
  const confirmScope = useRef(privacy.key);
  function setConfirm(request: ConfirmRequest | null) {
    confirmScope.current = privacy.key;
    setConfirmState(request);
  }
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const selected = useRef(threadId);
  selected.current = threadId;
  const [initialRequestKeys] = useState<
    Record<string, { text: string; key: string; environmentId?: string; sessionId?: string }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("bycoda.assistant.send-intents") ?? "{}");
    } catch {
      return {};
    }
  });
  const requestKey = useRef(initialRequestKeys);
  const nativeSendInFlight = useRef(false);
  const nativeDrafts = useRef(
    new Map<
      string,
      {
        environmentId: string;
        version: number;
        saved: string;
        desired: string;
        pending?: Promise<void>;
      }
    >(),
  );
  const [nativeDraftReady, setNativeDraftReady] = useState("");
  const [nativeDraftDisplayed, setNativeDraftDisplayed] = useState("");
  const nativeDraftKey = JSON.stringify([environmentId, threadId]);
  const [nativeDraftReload, setNativeDraftReload] = useState(0);
  const [draftRecovery, setDraftRecovery] = useState<{
    threadId: string;
    environmentId: string;
    backups: AssistantDraftBackup[];
    selected: string;
    selectedText?: string;
    selectedSavedAt?: number | null;
    revision?: number;
    next?: string;
    loading: boolean;
    error?: string;
  } | null>(null);
  const flushNativeDraft = useCallback(async (id: string) => {
    const state = nativeDrafts.current.get(id);
    if (!state) throw new Error("The draft is still loading.");
    while (state.pending) await state.pending;
    let wrote = false;
    const work = (async () => {
      for (;;) {
        const text = state.desired;
        if (text === state.saved) return;
        const version = await writeAssistantNativeDraft(
          id,
          state.environmentId,
          state.version,
          text,
        );
        state.version = version;
        state.saved = text;
        wrote = true;
      }
    })();
    state.pending = work;
    try {
      await work;
      nativeUnsavedConversationDrafts.delete(JSON.stringify([state.environmentId, id]));
      if (
        wrote &&
        selected.current === id &&
        currentScope.current.environmentId === state.environmentId &&
        nativeUnsavedConversationDrafts.size === 0
      )
        setDraftSaveError(false);
    } catch (error) {
      nativeUnsavedConversationDrafts.set(JSON.stringify([state.environmentId, id]), state.desired);
      setDraftSaveError(true);
      throw error;
    } finally {
      if (state.pending === work) state.pending = undefined;
    }
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    const unregister = registerAssistantDraftFlusher(async () => {
      for (const [id, state] of nativeDrafts.current) {
        const key = JSON.stringify([state.environmentId, id]);
        if (!mounted && !state.pending && !nativeUnsavedConversationDrafts.has(key)) continue;
        await flushNativeDraft(id);
      }
      if (nativeUnsavedConversationDrafts.size > 0)
        throw new Error("An assistant draft could not be saved. Recover it before closing.");
    });
    return () => {
      unregister();
      mounted = false;
    };
  }, [flushNativeDraft]);
  useEffect(() => {
    if (!isTauri() || !threadId || !environmentId) {
      setNativeDraftReady("");
      return;
    }
    let active = true;
    const id = threadId;
    const sourceEnvironment = environmentId;
    const previous = nativeDrafts.current.get(id);
    nativeDrafts.current.delete(id);
    setNativeDraftReady("");
    void (async () => {
      if (previous?.pending) await previous.pending;
      return readAssistantNativeDraft(id, sourceEnvironment);
    })()
      .then((stored) => {
        if (!active) return;
        const unsaved = nativeUnsavedConversationDrafts.get(
          JSON.stringify([sourceEnvironment, id]),
        );
        if (unsaved !== undefined && unsaved !== stored.text) {
          draftsRef.current = { ...draftsRef.current, [id]: unsaved };
          setDrafts((current) => ({ ...current, [id]: unsaved }));
          setNativeDraftDisplayed(JSON.stringify([sourceEnvironment, id]));
          setDraftSaveError(true);
          return;
        }
        if (unsaved !== undefined)
          nativeUnsavedConversationDrafts.delete(JSON.stringify([sourceEnvironment, id]));
        nativeDrafts.current.set(id, {
          environmentId: sourceEnvironment,
          version: stored.version,
          saved: stored.text,
          desired: stored.text,
        });
        draftsRef.current = { ...draftsRef.current, [id]: stored.text };
        setDrafts((current) => ({ ...current, [id]: stored.text }));
        setNativeDraftDisplayed(JSON.stringify([sourceEnvironment, id]));
        setNativeDraftReady(JSON.stringify([sourceEnvironment, id]));
        if (nativeUnsavedConversationDrafts.size === 0) setDraftSaveError(false);
      })
      .catch(() => {
        if (!active) return;
        const unsaved = nativeUnsavedConversationDrafts.get(
          JSON.stringify([sourceEnvironment, id]),
        );
        if (unsaved !== undefined) {
          draftsRef.current = { ...draftsRef.current, [id]: unsaved };
          setDrafts((current) => ({ ...current, [id]: unsaved }));
          setNativeDraftDisplayed(JSON.stringify([sourceEnvironment, id]));
        }
        setDraftSaveError(true);
      });
    return () => {
      active = false;
      const state = nativeDrafts.current.get(id);
      if (state?.environmentId === sourceEnvironment && state.desired !== state.saved)
        void flushNativeDraft(id).catch(() => {});
    };
  }, [threadId, environmentId, nativeDraftReload, flushNativeDraft]);
  useEffect(() => {
    if (!isTauri() || !threadId || !environmentId) return;
    const id = threadId;
    const sourceEnvironment = environmentId;
    const sourcePrivacy = privacy.key;
    let active = true;
    const refresh = () => {
      const state = nativeDrafts.current.get(id);
      if (
        !state ||
        state.environmentId !== sourceEnvironment ||
        state.pending ||
        state.desired !== state.saved
      )
        return;
      const expectedVersion = state.version;
      void readAssistantNativeDraft(id, sourceEnvironment)
        .then((stored) => {
          if (
            !active ||
            nativeDrafts.current.get(id) !== state ||
            state.pending ||
            state.version !== expectedVersion ||
            state.desired !== state.saved ||
            selected.current !== id ||
            currentScope.current.environmentId !== sourceEnvironment ||
            currentScope.current.privacy.key !== sourcePrivacy ||
            !threadVisible(id)
          )
            return;
          state.version = stored.version;
          state.saved = stored.text;
          state.desired = stored.text;
          draftsRef.current = { ...draftsRef.current, [id]: stored.text };
          setDrafts((current) => ({ ...current, [id]: stored.text }));
        })
        .catch(() => {
          if (active) setDraftSaveError(true);
        });
    };
    const unsubscribe = listenWindow<{ scope?: string }>("canonical-store-changed", (event) => {
      if (event.payload?.scope === "assistant-thread-drafts.v2") refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [threadId, environmentId, privacy.key]);
  const flushDrafts = useCallback(
    (report = true) => {
      if (maximumDraftTimer.current !== undefined) {
        window.clearTimeout(maximumDraftTimer.current);
        maximumDraftTimer.current = undefined;
      }
      const serialized = JSON.stringify(draftsRef.current);
      if (isTauri()) {
        for (const id of nativeDrafts.current.keys()) void flushNativeDraft(id).catch(() => {});
        return;
      }
      if (serialized === savedDrafts.current) return;
      try {
        localStorage.setItem("bycoda.assistant.thread-drafts", serialized);
        savedDrafts.current = serialized;
        unsavedConversationDrafts = undefined;
        if (report) setDraftSaveError(false);
      } catch {
        unsavedConversationDrafts = { ...draftsRef.current };
        if (report) setDraftSaveError(true);
      }
    },
    [flushNativeDraft],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => flushDrafts(), 400);
    maximumDraftTimer.current ??= window.setTimeout(() => flushDrafts(), 2000);
    return () => window.clearTimeout(timer);
  }, [drafts, flushDrafts]);
  useEffect(() => {
    const flush = () => flushDrafts();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flushDrafts(false);
    };
  }, [flushDrafts]);
  useEffect(() => () => flushDrafts(false), [threadId, flushDrafts]);

  return {
    assistantRequest,
    retainedThreadId,
    setThreadId,
    threadId,
    alive,
    currentScope,
    threadVisible,
    roomSourceStatus,
    messageVisible,
    threadUpdates,
    setThreadUpdates,
    threadUpdatesRef,
    newerThread,
    currentThreadFor,
    summaryScopeVisible,
    mergeThread,
    initialProject,
    scope,
    setScope,
    project,
    setProject,
    messages,
    setMessages,
    drafts,
    setDrafts,
    draftsRef,
    initialSavedDrafts,
    savedDrafts,
    maximumDraftTimer,
    draftSaveError,
    setDraftSaveError,
    operationPending,
    setPending,
    loadingMessages,
    setLoadingMessages,
    loadedThreads,
    setLoadedThreads,
    messageLoadSequence,
    pending,
    clearing,
    setClearing,
    threadMenu,
    setThreadMenu,
    summaryRefreshing,
    setSummaryRefreshing,
    summaryPending,
    summaryError,
    setSummaryError,
    clearingRef,
    searchEpoch,
    errorState,
    setErrorState,
    error,
    setError,
    confirm,
    setConfirmState,
    confirmScope,
    setConfirm,
    hasMore,
    setHasMore,
    selected,
    initialRequestKeys,
    requestKey,
    nativeSendInFlight,
    nativeDrafts,
    nativeDraftReady,
    setNativeDraftReady,
    nativeDraftDisplayed,
    setNativeDraftDisplayed,
    nativeDraftKey,
    nativeDraftReload,
    setNativeDraftReload,
    draftRecovery,
    setDraftRecovery,
    flushNativeDraft,
    flushDrafts,
  };
}
