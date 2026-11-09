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

  const [search, setSearch] = useState<{
    query: string;
    results: AssistantMessage[];
    settled: boolean;
  } | null>(null);
  const searchActive = query.trim() !== "";
  const searchCurrent = search?.query === query ? search : null;
  const searchResults = searchActive ? (searchCurrent?.results ?? []) : null;
  const searching = searchActive && !searchCurrent?.settled;
  const dropSearchResults = (keep: (message: AssistantMessage) => boolean) =>
    setSearch((current) =>
      current ? { ...current, results: current.results.filter(keep) } : current,
    );
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
          dropSearchResults((message) => message.threadId !== target.id);
        } finally {
          clearingRef.current = false;
          setClearing(false);
        }
      },
    });
  }
  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    const epoch = searchEpoch.current;
    const timer = setTimeout(() => {
      void assistantRequest({ op: "conversations.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled && epoch === searchEpoch.current)
            setSearch({ query, results: result.messages ?? [], settled: false });
        })
        .catch((cause) => {
          if (!cancelled && epoch === searchEpoch.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled)
            setSearch((current) =>
              current?.query === query
                ? { ...current, settled: true }
                : { query, results: [], settled: true },
            );
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
  const onHistoryScroll = (node: HTMLDivElement) => {
    followMessages.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
  };
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
        dropSearchResults((item) => item.id !== message.id);
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
    searching,
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
    onHistoryScroll,
    lastMessageId,
    day,
    time,
    messageElements,
    threadLabel,
  };
}
