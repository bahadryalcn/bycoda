import { beginAssistantDraftOperation } from "../../model/assistantDraftFlush";
import {
  preserveAssistantDraft,
  readAssistantDraftBackup,
  readAssistantDraftBackups,
  readAssistantNativeDraft,
  writeAssistantNativeDraft,
} from "../../model/assistantNativeSend";
import { useEffect } from "react";
import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { refreshAssistantSummary } from "../../model/assistantSummaryRefresh";
import {
  nativeUnsavedConversationDrafts,
  type ConversationPanelProps,
  type ConversationPanelState,
} from "./useConversationPanelState";

export type ConversationPanelMessagesState = ReturnType<typeof useConversationPanelMessages>;

export function useConversationPanelMessages(
  input: ConversationPanelProps & ConversationPanelState,
) {
  const {
    assistantRequest,
    setThreadId,
    threadId,
    alive,
    currentScope,
    threadVisible,
    summaryScopeVisible,
    mergeThread,
    scope,
    project,
    setMessages,
    setDrafts,
    draftsRef,
    setDraftSaveError,
    setPending,
    setLoadingMessages,
    setLoadedThreads,
    messageLoadSequence,
    pending,
    setSummaryRefreshing,
    summaryPending,
    setSummaryError,
    clearingRef,
    setError,
    setHasMore,
    selected,
    nativeDrafts,
    setNativeDraftReady,
    nativeDraftDisplayed,
    setNativeDraftDisplayed,
    draftRecovery,
    setDraftRecovery,
    environmentId,
    privacy,
    canSeeProject,
    isAppQuitting,
  } = input;

  async function load(id: string, cursor?: Pick<AssistantMessage, "id" | "createdAt">) {
    const sequence = ++messageLoadSequence.current;
    if (!id || !threadVisible(id)) {
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    setError("");
    try {
      const capturedEnvironment = environmentId;
      const result = await assistantRequest(
        {
          op: "threads.messages",
          threadId: id,
          limit: 100,
          ...(cursor ? { before: cursor.createdAt, beforeId: cursor.id } : {}),
        },
        capturedEnvironment,
      );
      if (
        !alive.current ||
        sequence !== messageLoadSequence.current ||
        currentScope.current.environmentId !== capturedEnvironment ||
        !threadVisible(id)
      )
        return;
      if (result.thread) mergeThread(result.thread, id, environmentId);
      const list = result.messages ?? [];
      setMessages((current) => ({
        ...current,
        [id]: cursor ? [...list, ...(current[id] ?? [])] : list,
      }));
      setHasMore((current) => ({ ...current, [id]: list.length === 100 }));
      setLoadedThreads((current) => (current[id] ? current : { ...current, [id]: true }));
    } catch (cause) {
      if (sequence === messageLoadSequence.current && selected.current === id && threadVisible(id))
        setError(cause instanceof Error ? t(cause.message) : String(cause));
      if (sequence === messageLoadSequence.current)
        setLoadedThreads((current) => (current[id] ? current : { ...current, [id]: true }));
    } finally {
      if (sequence === messageLoadSequence.current) setLoadingMessages(false);
    }
  }
  useEffect(() => {
    load(threadId);
  }, [threadId]);
  async function refreshSummary() {
    const target = { threadId, environmentId, privacyKey: privacy.key };
    if (
      !target.threadId ||
      !target.environmentId ||
      summaryPending.current ||
      clearingRef.current ||
      !summaryScopeVisible(target.threadId)
    )
      return;
    const current = () =>
      alive.current &&
      selected.current === target.threadId &&
      currentScope.current.environmentId === target.environmentId &&
      currentScope.current.privacy.key === target.privacyKey &&
      summaryScopeVisible(target.threadId);
    summaryPending.current = true;
    setSummaryRefreshing(true);
    setSummaryError(null);
    try {
      const thread = await refreshAssistantSummary(
        localStorage,
        target.environmentId,
        target.threadId,
        assistantRequest,
        current,
      );
      if (current()) mergeThread(thread, target.threadId, target.environmentId);
    } catch {
      if (current())
        setSummaryError({
          threadId: target.threadId,
          text: t("Summary refresh was not confirmed."),
        });
    } finally {
      summaryPending.current = false;
      if (alive.current) setSummaryRefreshing(false);
    }
  }
  async function open() {
    if (pending || clearingRef.current) return;
    if (scope !== "global" && !canSeeProject(project)) return;
    setPending(true);
    setError("");
    try {
      const result = await assistantRequest({
        op: "threads.open",
        ...(scope !== "global" && project ? { projectId: project } : {}),
      });
      if (result.thread) setThreadId(result.thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : String(cause));
    } finally {
      setPending(false);
    }
  }
  async function loadDraftBackups(
    id: string,
    sourceEnvironment: string,
    after?: string,
    revision?: number,
  ) {
    try {
      const page = await readAssistantDraftBackups(id, sourceEnvironment, after, revision);
      setDraftRecovery((current) => {
        if (!current || current.threadId !== id || current.environmentId !== sourceEnvironment)
          return current;
        const merged = after
          ? [
              ...current.backups,
              ...page.backups.filter(
                (item) => !current.backups.some((old) => old.hash === item.hash),
              ),
            ]
          : page.backups;
        return {
          ...current,
          backups: merged,
          revision: page.revision,
          next: page.next,
          loading: false,
          error: undefined,
        };
      });
    } catch (cause) {
      setDraftRecovery((current) =>
        current && current.threadId === id && current.environmentId === sourceEnvironment
          ? {
              ...current,
              loading: false,
              error: cause instanceof Error ? t(cause.message) : String(cause),
            }
          : current,
      );
    }
  }
  function openDraftRecovery() {
    if (!threadId || !environmentId || !threadVisible(threadId)) return;
    setDraftRecovery({
      threadId,
      environmentId,
      backups: [],
      selected: "",
      loading: true,
    });
    void loadDraftBackups(threadId, environmentId).catch((cause: unknown) =>
      setError(cause instanceof Error ? t(cause.message) : String(cause)),
    );
  }
  async function selectDraftBackup(hash: string) {
    const recovery = draftRecovery;
    if (!recovery || recovery.loading) return;
    setDraftRecovery({
      ...recovery,
      selected: hash,
      selectedText: undefined,
      selectedSavedAt: undefined,
      loading: true,
      error: undefined,
    });
    try {
      const backup = await readAssistantDraftBackup(
        recovery.threadId,
        recovery.environmentId,
        hash,
      );
      setDraftRecovery((current) =>
        current &&
        current.threadId === recovery.threadId &&
        current.environmentId === recovery.environmentId &&
        current.selected === hash
          ? {
              ...current,
              selectedText: backup.text,
              selectedSavedAt: backup.savedAt,
              loading: false,
            }
          : current,
      );
    } catch (cause) {
      setDraftRecovery((current) =>
        current &&
        current.threadId === recovery.threadId &&
        current.environmentId === recovery.environmentId &&
        current.selected === hash
          ? {
              ...current,
              loading: false,
              error: cause instanceof Error ? t(cause.message) : String(cause),
            }
          : current,
      );
    }
  }
  async function restoreDraftBackup() {
    if (isAppQuitting()) return;
    const recovery = draftRecovery;
    if (
      !recovery ||
      recovery.selectedText === undefined ||
      recovery.loading ||
      selected.current !== recovery.threadId ||
      currentScope.current.environmentId !== recovery.environmentId ||
      !threadVisible(recovery.threadId)
    )
      return;
    const release = beginAssistantDraftOperation();
    setDraftRecovery({ ...recovery, loading: true, error: undefined });
    try {
      const old = nativeDrafts.current.get(recovery.threadId);
      if (old?.pending) await old.pending;
      const recoveryKey = JSON.stringify([recovery.environmentId, recovery.threadId]);
      const localText =
        nativeDraftDisplayed === recoveryKey
          ? (draftsRef.current[recovery.threadId] ?? "")
          : (nativeUnsavedConversationDrafts.get(recoveryKey) ?? "");
      await preserveAssistantDraft(recovery.threadId, recovery.environmentId, localText);
      const latest = await readAssistantNativeDraft(
        recovery.threadId,
        recovery.environmentId,
        true,
      );
      await preserveAssistantDraft(recovery.threadId, recovery.environmentId, latest.text);
      if (
        selected.current !== recovery.threadId ||
        currentScope.current.environmentId !== recovery.environmentId ||
        !threadVisible(recovery.threadId)
      )
        throw new Error("The original conversation is no longer available.");
      const version = await writeAssistantNativeDraft(
        recovery.threadId,
        recovery.environmentId,
        latest.version,
        recovery.selectedText,
      );
      nativeDrafts.current.set(recovery.threadId, {
        environmentId: recovery.environmentId,
        version,
        saved: recovery.selectedText,
        desired: recovery.selectedText,
      });
      draftsRef.current = {
        ...draftsRef.current,
        [recovery.threadId]: recovery.selectedText,
      };
      setDrafts((current) => ({
        ...current,
        [recovery.threadId]: recovery.selectedText!,
      }));
      nativeUnsavedConversationDrafts.delete(
        JSON.stringify([recovery.environmentId, recovery.threadId]),
      );
      setDraftSaveError(nativeUnsavedConversationDrafts.size > 0);
      setNativeDraftReady(JSON.stringify([recovery.environmentId, recovery.threadId]));
      setNativeDraftDisplayed(JSON.stringify([recovery.environmentId, recovery.threadId]));
      setDraftRecovery(null);
    } catch (cause) {
      setDraftRecovery((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: cause instanceof Error ? t(cause.message) : String(cause),
            }
          : current,
      );
    } finally {
      release();
    }
  }

  return {
    load,
    refreshSummary,
    open,
    loadDraftBackups,
    openDraftRecovery,
    selectDraftBackup,
    restoreDraftBackup,
  };
}
