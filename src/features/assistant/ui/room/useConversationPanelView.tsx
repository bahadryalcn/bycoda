import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t, useLocale } from "../../../../shared/i18n";
import { visibleAssistantMessages } from "../../model/assistantPrivacy";
import { ConversationDayLabel, ConversationMessage } from "./ConversationMessage";
import type { ConversationPanelProps, ConversationPanelState } from "./useConversationPanelState";
import type { ConversationPanelMessagesState } from "./useConversationPanelMessages";
import type { ConversationPanelSendState } from "./useConversationPanelSend";

const emptyAssistantMessages: AssistantMessage[] = [];

export function useConversationPanelView(
  input: ConversationPanelProps &
    ConversationPanelState &
    ConversationPanelMessagesState &
    ConversationPanelSendState,
) {
  const {
    assistantRequest,
    threadId,
    threadVisible,
    messageVisible,
    threadUpdates,
    newerThread,
    currentThreadFor,
    mergeThread,
    messages,
    setMessages,
    pending,
    clearing,
    setClearing,
    summaryPending,
    clearingRef,
    searchEpoch,
    setError,
    setConfirm,
    setHasMore,
    environmentId,
    snapshot,
    source,
    privacy,
    projects,
    query,
    onOpenSession,
    onJob,
  } = input;

  const [searchResults, setSearchResults] = useState<AssistantMessage[] | null>(null);
  const [searching, setSearching] = useState(false);
  function clearConversation() {
    const thread = currentThreadFor(threadId);
    if (!thread || pending || clearingRef.current || summaryPending.current) return;
    const target = { id: thread.id, version: thread.version };
    setConfirm({
      title: t("Clear this conversation?"),
      message: t(
        "Move all messages in this conversation to Recently deleted for seven days. The saved summary and your unsent draft stay available.",
      ),
      confirmLabel: t("Clear all messages"),
      pendingLabel: t("Clearing..."),
      onConfirm: async () => {
        if (!threadVisible(target.id)) return;
        if (clearingRef.current) return;
        clearingRef.current = true;
        setClearing(true);
        setError("");
        searchEpoch.current++;
        try {
          const result = await assistantRequest({
            op: "threads.clear",
            threadId: target.id,
            expectedVersion: target.version,
          });
          if (result.thread?.id !== target.id)
            throw new Error(t("The conversation clear was not confirmed. Check before retrying."));
          mergeThread(result.thread, target.id, environmentId);
          setMessages((current) => ({ ...current, [target.id]: [] }));
          setHasMore((current) => ({ ...current, [target.id]: false }));
          setSearchResults((current) =>
            current ? current.filter((message) => message.threadId !== target.id) : current,
          );
        } finally {
          clearingRef.current = false;
          setClearing(false);
        }
      },
    });
  }
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const epoch = searchEpoch.current;
    setSearching(true);
    setSearchResults([]);
    const timer = setTimeout(() => {
      void assistantRequest({ op: "conversations.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled && epoch === searchEpoch.current) setSearchResults(result.messages ?? []);
        })
        .catch((cause) => {
          if (!cancelled && epoch === searchEpoch.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const currentMessages = searchResults ?? messages[threadId] ?? emptyAssistantMessages;
  const visible = useMemo(
    () => visibleAssistantMessages(currentMessages, source, privacy),
    [currentMessages, source, privacy],
  );
  const supported = snapshot.capabilities.conversations;
  const currentThread = newerThread(
    snapshot.threads.find((thread) => thread.id === threadId),
    threadUpdates[threadId],
  );
  const summaryState = currentThread?.summaryState;
  const summaryLabel =
    summaryState?.status === "pending" || summaryState?.status === "working"
      ? t("Updating conversation summary")
      : summaryState?.status === "blocked"
        ? t("Summary waiting")
        : "";
  const locale = useLocale();
  const history = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  useEffect(() => {
    followMessages.current = true;
  }, [threadId, query]);
  const lastMessageId = visible[visible.length - 1]?.id;
  useEffect(() => {
    if (!query && followMessages.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [threadId, query, lastMessageId]);
  const day = (timestamp: number) =>
    formatDate(timestamp, { day: "numeric", month: "long", year: "numeric" });
  const time = (timestamp: number) => formatDate(timestamp, { hour: "2-digit", minute: "2-digit" });
  const deleteMessage = (message: AssistantMessage) =>
    setConfirm({
      title: t("Delete message?"),
      message: message.text,
      confirmLabel: t("Delete"),
      onConfirm: async () => {
        if (!messageVisible(message)) return;
        await assistantRequest({
          op: "messages.delete",
          id: message.id,
          expectedVersion: message.version,
        });
        setMessages((current) => ({
          ...current,
          [message.threadId]: (current[message.threadId] ?? []).filter(
            (item) => item.id !== message.id,
          ),
        }));
        setSearchResults((current) => current?.filter((item) => item.id !== message.id) ?? null);
      },
    });
  const messageElements = useMemo(
    () =>
      visible.map((message, index) => (
        <Fragment key={message.id}>
          {(index === 0 || day(visible[index - 1].createdAt) !== day(message.createdAt)) && (
            <ConversationDayLabel at={message.createdAt} />
          )}
          <ConversationMessage
            message={message}
            authorName={snapshot.profile.name}
            jobs={snapshot.jobs}
            clearing={clearing}
            onOpenSession={onOpenSession}
            onJob={onJob}
            onDelete={deleteMessage}
          />
        </Fragment>
      )),
    [
      visible,
      locale,
      clearing,
      snapshot.profile.name,
      snapshot.jobs,
      onOpenSession,
      onJob,
      privacy.key,
      environmentId,
      assistantRequest,
    ],
  );
  const threadLabel = currentThread?.projectId
    ? (projects.find((project) => (project.id ?? project.path) === currentThread.projectId)?.name ??
      currentThread.projectId)
    : t("Global");

  return {
    searchResults,
    setSearchResults,
    searching,
    setSearching,
    clearConversation,
    currentMessages,
    visible,
    supported,
    currentThread,
    summaryState,
    summaryLabel,
    locale,
    history,
    followMessages,
    lastMessageId,
    day,
    time,
    messageElements,
    threadLabel,
  };
}
