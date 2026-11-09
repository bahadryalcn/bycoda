import { useLayoutEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { formatAttachmentSize } from "../../../shared/i18n/format";
import { openExternal } from "../../../platform/tauri/openExternal";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { ExternalLink, MessageMultiple, RefreshCw } from "../../../shared/ui/icons";
import { useThreadMessages } from "../hooks/useThreadMessages";
import { splitMessageText } from "../model/messageText";
import { MESSAGING_PROVIDER_LABELS } from "../model/messageThreads";
import type { MessageThread, MessagingAccount, ThreadMessage } from "../model/messagingTypes";
import { emailReplyAddress } from "../model/threadMessages";
import { MessageReplyComposer } from "./MessageReplyComposer";
import { MessagingProviderMark } from "./MessagingProviderMark";
import styles from "./messages.module.css";

function MessageBody({ body, onOpenLink }: { body: string; onOpenLink: (url: string) => void }) {
  return (
    <div className={styles.bubble} dir="auto">
      {splitMessageText(body).map((part, index) =>
        part.kind === "link" ? (
          <Button
            // Parts are positional and never reordered within one body.
            key={index}
            variant="link"
            layout="text"
            // A wrapped URL keeps the bubble's start alignment instead of centering.
            className="wrap-anywhere text-start"
            onClick={() => onOpenLink(part.url)}
          >
            {part.text}
          </Button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </div>
  );
}

function MessageItem({
  message,
  onOpenLink,
}: {
  message: ThreadMessage;
  onOpenLink: (url: string) => void;
}) {
  const author = message.outbound
    ? t("You")
    : message.author || message.authorAddress || t("Unknown");
  return (
    <li className={styles.message} data-outbound={message.outbound ? "true" : undefined}>
      <span className={styles.meta}>
        <span className="min-w-0 truncate font-medium" title={message.authorAddress || undefined}>
          {author}
        </span>
        {Number.isFinite(message.at) && message.at > 0 ? (
          <Timestamp value={message.at} className="shrink-0" />
        ) : null}
      </span>
      {message.body ? <MessageBody body={message.body} onOpenLink={onOpenLink} /> : null}
      {message.attachments.length > 0 ? (
        <ul className={styles.attachments} aria-label={t("Attachments")}>
          {message.attachments.map((attachment, index) => {
            const size = attachment.size ? formatAttachmentSize(attachment.size) : null;
            return (
              <li
                key={`${attachment.name}:${index}`}
                className="max-w-full truncate rounded-(--ui-radius-control) border border-(--ui-tone-neutral-border) px-1.5 text-ui-micro text-(--ui-text-secondary)"
                title={attachment.name}
              >
                {size ? t("{p0} ({p1})", { p0: attachment.name, p1: size }) : attachment.name}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/** One conversation: header, messages oldest to newest and the reply composer. */
export function MessageThreadView({
  thread,
  account,
  onSent,
}: {
  thread: MessageThread;
  account: MessagingAccount | undefined;
  onSent: (thread: MessageThread, message: ThreadMessage) => void;
}) {
  useLocale();
  const { messages, error, loading, reload, append } = useThreadMessages(thread);
  const [linkError, setLinkError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = messages?.length ?? 0;

  // Open at the newest message and follow new ones.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count]);

  const openLink = (url: string) => {
    setLinkError("");
    openExternal(url).catch(() => setLinkError(t("Could not open the link. Try again.")));
  };
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
      <header className="flex shrink-0 items-start gap-2 border-b border-(--ui-tone-neutral-border) px-4 py-2">
        <MessagingProviderMark
          provider={thread.provider}
          className="mt-0.5 block icon-sm shrink-0 text-(--ui-text-secondary)"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-ui-body font-medium" title={thread.title} dir="auto">
            {thread.title || t("(No subject)")}
          </h2>
          <p
            className="truncate text-ui-micro text-(--ui-text-secondary)"
            title={thread.participants.join(", ")}
          >
            {thread.participants.length > 0
              ? t("{p0} · {p1}", { p0: thread.participants.join(", "), p1: accountLine })
              : accountLine}
          </p>
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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {messages == null ? (
          error ? (
            <EmptyState
              kind="unavailable"
              icon={<MessageMultiple aria-hidden="true" />}
              title={t("Could not load this conversation.")}
              description={error}
              onRetry={reload}
              retrying={loading}
            />
          ) : (
            <LoadingText className="justify-center py-10">{t("Loading conversation…")}</LoadingText>
          )
        ) : (
          <>
            {error ? (
              <InlineError className="mx-4 mt-2" retry={{ onRetry: reload, pending: loading }}>
                {t("Could not refresh this conversation. {p0}", { p0: error })}
              </InlineError>
            ) : null}
            {messages.length === 0 ? (
              <EmptyState
                kind="empty"
                size="inline"
                className="px-4 py-3"
                description={t("No messages in this conversation yet.")}
              />
            ) : (
              <ol className={styles.timeline} aria-label={t("Messages")}>
                {messages.map((message) => (
                  <MessageItem key={message.id} message={message} onOpenLink={openLink} />
                ))}
              </ol>
            )}
          </>
        )}
      </div>
      <MessageReplyComposer
        key={`${thread.accountId}\u0000${thread.id}`}
        thread={thread}
        replyAddress={thread.provider === "email" ? emailReplyAddress(messages) : null}
        onSent={(message) => {
          append(message);
          onSent(thread, message);
        }}
      />
    </section>
  );
}
