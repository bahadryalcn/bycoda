import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { FailureState } from "../../../shared/ui/FailureState";
import { Text } from "../../../shared/ui/Text";
import { useLayoutEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { openExternal } from "../../../platform/tauri/openExternal";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Button } from "../../../shared/ui/Button";
import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { MessageTimeline } from "../../../shared/ui/MessageTimeline";
import { ChevronDown, ExternalLink, MessageMultiple, RefreshCw } from "../../../shared/ui/icons";
import { useThreadMessages } from "../hooks/useThreadMessages";
import { MESSAGING_PROVIDER_LABELS } from "../model/messageThreads";
import type { MessageThread, MessagingAccount, ThreadMessage } from "../model/messagingTypes";
import { emailReplyAddress, isAtThreadEnd } from "../model/threadMessages";
import { MessageReplyComposer } from "./MessageReplyComposer";
import { MessagingProviderMark } from "./MessagingProviderMark";
import { createThreadMessageProjection } from "./threadMessageItems";

/**
 * One conversation: header, the newest messages (earlier ones on request) oldest to newest and
 * the reply composer. A long conversation mounts only the rows near the viewport.
 */
export function MessageThreadView({
  thread,
  account,
  onSent,
}: {
  thread: MessageThread;
  account: MessagingAccount | undefined;
  onSent: (thread: MessageThread, message: ThreadMessage) => void;
}) {
  const locale = useLocale();
  const {
    messages,
    error,
    loading,
    reload,
    append,
    hasEarlier,
    loadingEarlier,
    earlierError,
    loadEarlier,
  } = useThreadMessages(thread);
  const [linkError, setLinkError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // The reader follows the newest message until they scroll up, so a refresh or an opened
  // earlier page never drags them away from what they are reading.
  const followEnd = useRef(true);
  // Distance from the end of the scroller when earlier messages were requested, to keep the
  // same messages in view once they are added above.
  const earlierAnchor = useRef<number | null>(null);
  // The button that opened an earlier page unmounts with the last one; focus then moves to the list.
  const refocus = useRef(false);
  // A message arrived while the reader was away from the end; the jump button brings them back.
  const [unseen, setUnseen] = useState(false);
  const loaded = messages !== null;
  const firstId = messages?.[0]?.id;
  const lastId = messages?.[messages.length - 1]?.id;
  const previousLastId = useRef(lastId);

  const scrollToEnd = () => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Follow new messages in the DOM scroller or show the jump control when the reader has scrolled away.
  useLayoutEffect(() => {
    const arrived = lastId !== undefined && previousLastId.current !== lastId;
    previousLastId.current = lastId;
    if (followEnd.current) {
      scrollToEnd();
      setUnseen(false);
    } else if (arrived) setUnseen(true);
  }, [loaded, lastId]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Restore the scroller's anchor after inserting earlier messages above the reader.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const distance = earlierAnchor.current;
    if (!element || distance === null) return;
    earlierAnchor.current = null;
    element.scrollTop = element.scrollHeight - distance;
  }, [firstId]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Clear the pending DOM scroll anchor when the earlier page request fails.
  useLayoutEffect(() => {
    if (earlierError) earlierAnchor.current = null;
  }, [earlierError]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Restore DOM focus to the conversation when the last page removes its load button.
  useLayoutEffect(() => {
    if (hasEarlier || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === document.body) scrollRef.current?.focus({ preventScroll: true });
  }, [hasEarlier]);

  const onScroll = (element: HTMLDivElement) => {
    const atEnd = isAtThreadEnd(element);
    followEnd.current = atEnd;
    if (atEnd) setUnseen(false);
  };
  const jumpToLatest = () => {
    followEnd.current = true;
    setUnseen(false);
    scrollToEnd();
    // The button unmounts on this click; keyboard focus moves to the conversation, not the page.
    scrollRef.current?.focus({ preventScroll: true });
  };
  const onLoadEarlier = () => {
    const element = scrollRef.current;
    if (element) {
      earlierAnchor.current = element.scrollHeight - element.scrollTop;
      refocus.current = element.contains(document.activeElement);
    }
    followEnd.current = false;
    loadEarlier();
  };
  // Keeps the reader at the end while measured rows replace estimates in the windowed list.
  const keepEnd = () => {
    if (followEnd.current) scrollToEnd();
  };

  const openLink = useStableCallback((url: string) => {
    setLinkError("");
    openExternal(url).catch(() => setLinkError(t("Could not open the link. Try again.")));
  });
  const [project] = useState(createThreadMessageProjection);
  const items = messages ? project(messages, openLink, locale) : [];
  const providerLabel = t(MESSAGING_PROVIDER_LABELS[thread.provider]);
  const accountLine = account
    ? [account.label || providerLabel, account.identity].filter(Boolean).join(" · ")
    : providerLabel;

  return (
    <section
      aria-label={thread.title || t("Conversation")}
      aria-busy={loading}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <header
        {...surfaceAttributes(
          { frame: "pane", edge: "bottom" },
          "flex shrink-0 items-start gap-2 px-4 py-2",
        )}
      >
        <MessagingProviderMark
          provider={thread.provider}
          tone="secondary"
          className="mt-0.5 block icon-sm shrink-0"
        />
        <div className="min-w-0 flex-1">
          <Tooltip label={thread.title} asChild>
            <Heading size="section" level={2} truncate dir="auto">
              {thread.title || t("(No subject)")}
            </Heading>
          </Tooltip>
          <Tooltip label={thread.participants.join(", ")} asChild>
            <Text as="p" size="micro" tone="secondary" truncate>
              {thread.participants.length > 0
                ? t("{p0} · {p1}", { p0: thread.participants.join(", "), p1: accountLine })
                : accountLine}
            </Text>
          </Tooltip>
        </div>
        <Button
          iconOnly
          variant="ghost"
          label={t("Reload conversation")}
          loading={loading}
          onClick={reload}
          className="shrink-0"
        >
          <RefreshCw className="icon-sm" strokeWidth={1.75} />
        </Button>
        {thread.url ? (
          <Button
            iconOnly
            variant="ghost"
            label={t("Open in {p0}", { p0: providerLabel })}
            onClick={() => openLink(thread.url as string)}
            className="shrink-0"
          >
            <ExternalLink className="icon-sm" strokeWidth={1.75} />
          </Button>
        ) : null}
      </header>
      {linkError ? <InlineError className="mx-4 mt-2">{linkError}</InlineError> : null}
      <div
        ref={scrollRef}
        // Focusable only by script, as the landing place when the last "Load earlier" button unmounts.
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => onScroll(event.currentTarget)}
      >
        {messages == null ? (
          error ? (
            <FailureState
              icon={<MessageMultiple aria-hidden="true" />}
              title={t("Could not load this conversation.")}
              description={error}
              onRetry={reload}
              retrying={loading}
            />
          ) : (
            <LoadingText inset="panel" className="justify-center">
              {t("Loading conversation…")}
            </LoadingText>
          )
        ) : (
          <>
            {error ? (
              <InlineError className="mx-4 mt-2" retry={{ onRetry: reload, pending: loading }}>
                {t("Could not refresh this conversation. {p0}", { p0: error })}
              </InlineError>
            ) : null}
            {hasEarlier ? (
              <div className="flex justify-center px-4 pt-2">
                <CollectionFooter
                  standalone
                  hasMore
                  loadMoreLabel={
                    loadingEarlier ? t("Loading earlier messages…") : t("Load earlier messages")
                  }
                  loadMoreButtonProps={{ loading: loadingEarlier }}
                  onLoadMore={onLoadEarlier}
                />
              </div>
            ) : null}
            {earlierError ? (
              <InlineError
                className="mx-4 mt-2"
                details={earlierError}
                retry={{
                  onRetry: onLoadEarlier,
                  label: t("Load earlier messages again"),
                  pending: loadingEarlier,
                }}
              >
                {t("Could not load earlier messages.")}
              </InlineError>
            ) : null}
            {messages.length === 0 ? (
              <EmptyState
                kind="empty"
                size="inline"
                inset="panel"
                description={t("No messages in this conversation yet.")}
              />
            ) : (
              // The timeline's CSS module resets its own padding, so the gutter lives on a wrapper.
              <div className="px-4 py-3">
                <MessageTimeline
                  windowed
                  label={t("Messages")}
                  items={items}
                  onSizeChange={keepEnd}
                />
              </div>
            )}
          </>
        )}
      </div>
      {unseen ? (
        <div className="flex shrink-0 justify-center pb-2">
          <Button
            variant="secondary"
            size="sm"
            shape="pill"
            type="button"
            startIcon={<ChevronDown className="icon-md" strokeWidth={2} />}
            onClick={jumpToLatest}
          >
            {t("Jump to latest")}
          </Button>
        </div>
      ) : null}
      <MessageReplyComposer
        key={`${thread.accountId}\u0000${thread.id}`}
        thread={thread}
        replyAddress={thread.provider === "email" ? emailReplyAddress(messages) : null}
        onSent={(message) => {
          // The reader's own reply is always shown, wherever they had scrolled.
          followEnd.current = true;
          append(message);
          onSent(thread, message);
        }}
      />
    </section>
  );
}
