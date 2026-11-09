import { isTauri } from "@tauri-apps/api/core";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import { ConfirmDialog } from "../../../../shared/ui/ConfirmDialog";
import { Skeleton } from "../../../../shared/ui/Skeleton";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LiveText } from "../../../../shared/ui/LiveText";
import styles from "./Conversation.module.css";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationDraftRecovery } from "./ConversationDraftRecovery";
import { ConversationHeader } from "./ConversationHeader";
import { conversationTranscriptState } from "./ConversationTranscriptState";
import { ConversationThreadList } from "./ConversationThreadList";
import type { ConversationContext } from "./ConversationTypes";
import type { ConversationPanelProps } from "./useConversationPanelState";
import { useConversationPanelState } from "./useConversationPanelState";
import { useConversationPanelMessages } from "./useConversationPanelMessages";
import { useConversationPanelSend } from "./useConversationPanelSend";
import { useConversationPanelView } from "./useConversationPanelView";

export function ConversationPanel(props: ConversationPanelProps) {
  const panelState = useConversationPanelState(props);
  const panelMessages = useConversationPanelMessages({
    ...props,
    ...panelState,
  });
  const panelSend = useConversationPanelSend({
    ...props,
    ...panelState,
    ...panelMessages,
  });
  const panelView = useConversationPanelView({
    ...props,
    ...panelState,
    ...panelMessages,
    ...panelSend,
  });
  const all = {
    ...props,
    ...panelState,
    ...panelMessages,
    ...panelSend,
    ...panelView,
  };
  const c: ConversationContext = all;
  const {
    threadId,
    currentScope,
    threadVisible,
    messages,
    draftSaveError,
    pending,
    clearing,
    error,
    confirm,
    confirmScope,
    setConfirm,
    setError,
    hasMore,
    selected,
    nativeDraftReady,
    nativeDraftKey,
    setNativeDraftReload,
    draftRecovery,
    flushDrafts,
    privacy,
    load,
    openDraftRecovery,
    checkConversation,
    searching,
    visible,
    supported,
    summaryRefreshing,
    summaryLabel,
    history,
    followMessages,
    messageElements,
    query,
    loadedThreads,
  } = c;
  const transcript = conversationTranscriptState({
    threadId,
    query,
    searching,
    loaded: Boolean(loadedThreads[threadId]),
    visibleCount: visible.length,
  });
  const reportFailure = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  return (
    <div className={styles.layout}>
      <ConversationThreadList c={c} onFailure={reportFailure} />
      <div className={styles.transcript}>
        <ConversationHeader c={c} onFailure={reportFailure} />
        <div
          className={styles.messages}
          ref={history}
          onScroll={(event) => {
            const node = event.currentTarget;
            followMessages.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          }}
        >
          {hasMore[threadId] && (
            <CollectionFooter
              standalone
              hasMore
              loadMoreButtonProps={{
                variant: "secondary",
                disabled: pending || clearing,
              }}
              loadMoreLabel={t("Load earlier messages")}
              onLoadMore={() => void load(threadId, messages[threadId]?.[0]).catch(reportFailure)}
            />
          )}
          {transcript === "loading" && (
            <div className={styles.messageSkeleton}>
              <Skeleton lines={3} />
              <Skeleton lines={2} aria-hidden />
              <Skeleton lines={3} aria-hidden />
            </div>
          )}
          {(transcript === "empty" || transcript === "filtered" || transcript === "closed") && (
            <EmptyState
              size="inline"
              kind={transcript === "filtered" ? "filtered" : "empty"}
              description={t(
                transcript === "filtered"
                  ? "No results"
                  : transcript === "empty"
                    ? "No messages yet"
                    : "Open a conversation to begin",
              )}
            />
          )}
          {messageElements}
        </div>
        <LiveText className="sr-only" mode="assertive" text={error} />
        <LiveText
          className="sr-only"
          text={
            searching
              ? t("Loading...")
              : summaryRefreshing
                ? t("Updating conversation summary")
                : summaryLabel || ""
          }
        />
        {error && (
          <div className={styles.feedback}>
            <InlineError
              live="off"
              retry={{
                onRetry: () => void checkConversation().catch(reportFailure),
                disabled: pending || clearing,
              }}
            >
              {error}
            </InlineError>
          </div>
        )}
        {draftSaveError && (
          <InlineError className={styles.draftError}>
            {t("Could not save this draft. It is kept in this window.")}{" "}
            <Button
              type="button"
              onClick={() => {
                if (isTauri() && nativeDraftReady !== nativeDraftKey)
                  setNativeDraftReload((value) => value + 1);
                else flushDrafts();
              }}
            >
              {t("Retry saving")}
            </Button>
            {isTauri() && (
              <Button type="button" onClick={openDraftRecovery}>
                {t("Recover draft")}
              </Button>
            )}
          </InlineError>
        )}
        <ConversationComposer c={c} onFailure={reportFailure} />
        {!supported && (
          <p className={styles.composerNote}>
            {t("Conversation replies are unavailable. Configure a model on this Host.")}
          </p>
        )}
        {draftRecovery &&
          selected.current === draftRecovery.threadId &&
          currentScope.current.environmentId === draftRecovery.environmentId &&
          threadVisible(draftRecovery.threadId) && <ConversationDraftRecovery c={c} />}
        {confirm && confirmScope.current === privacy.key && (
          <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
        )}
      </div>
    </div>
  );
}
