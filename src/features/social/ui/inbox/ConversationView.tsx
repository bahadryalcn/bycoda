import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Text } from "../../../../shared/ui/Text";
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialClient } from "../../model/socialClient";
import { FailureState } from "../../../../shared/ui/FailureState";
import { channelName, PlatformIcon } from "../common/PlatformIcon";
import { SocialAvatar } from "../common/SocialAvatar";
import { LinkedInCommentActions } from "../linkedin/LinkedInCommentActions";
import { inboxApi } from "./inboxApi";
import { statusText, statusTone, timelineLines, type MessageLine } from "./inboxModel";
import { MessageTimeline } from "./MessageTimeline";
import {
  INBOX_STATUSES,
  INBOX_TAG_MAX_LENGTH,
  INBOX_TAGS_MAX,
  type InboxItem,
  type InboxStatus,
} from "./inboxTypes";
import { ReplyBox } from "./ReplyBox";
import { InstagramCommentActions } from "./InstagramCommentActions";
import {
  useInboxAccounts,
  useInboxInvalidate,
  useInboxThread,
  useInboxTimeline,
  useSavedInboxTags,
} from "./useInboxData";
import "./inbox.css";
import { isImeComposition } from "../../../../shared/lib/keyboard";

/**
 * One conversation. A known person shows every channel on one timeline; otherwise the
 * conversation's own events. Message text is shown as plain text only.
 */
export function ConversationView({
  client,
  threadId,
  item,
  accountName,
}: {
  client: SocialClient;
  threadId?: string;
  item?: InboxItem;
  /** Display name of the account the conversation belongs to, when known. */
  accountName?: string;
}) {
  const api = inboxApi(client);
  const thread = useInboxThread(client, threadId);
  const timeline = useInboxTimeline(client, item?.person?.id);
  const snapshot = useInboxAccounts(client, false);
  const invalidate = useInboxInvalidate(client);
  const applyTags = useSavedInboxTags(client);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const statusButton = useRef<HTMLButtonElement>(null);
  const article = useRef<HTMLElement>(null);
  // Offset and height of the timeline before an older page is requested; read back once it renders.
  const olderAnchor = useRef<{ top: number; height: number } | null>(null);
  const pageCount = timeline.data?.pages.length ?? 0;
  // The DOM only prepends the older rows; the reader's offset is restored here so their place stays put.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- scroll offsets are DOM state that React does not track, so this effect must write them after commit
  useLayoutEffect(() => {
    const saved = olderAnchor.current;
    olderAnchor.current = null;
    const list = article.current?.querySelector<HTMLElement>(".inbox-timeline");
    if (saved && list) list.scrollTop = saved.top + list.scrollHeight - saved.height;
  }, [pageCount]);

  const loadOlder = async () => {
    const list = article.current?.querySelector<HTMLElement>(".inbox-timeline");
    olderAnchor.current = list ? { top: list.scrollTop, height: list.scrollHeight } : null;
    const result = await timeline.fetchNextPage();
    if (result.isError) olderAnchor.current = null;
  };

  if (!threadId)
    return (
      <EmptyState
        context="page"
        illustration="chat-empty"
        title={t("Select a conversation")}
        description={t("Choose a conversation to read and reply.")}
      />
    );
  if (thread.isPending)
    return <LoadingText layout="fill">{t("Loading conversation…")}</LoadingText>;
  if (!thread.data)
    return (
      <FailureState
        context="panel"
        title={t("This conversation could not be opened.")}
        onRetry={async () => {
          await thread.refetch().catch(() => undefined);
        }}
        retrying={thread.isFetching}
      />
    );

  const conversation = thread.data;
  const instagram = snapshot.data?.accounts.find(
    (account) => account.id === conversation.accountId && account.platform === "instagram",
  );
  const lines: MessageLine[] = item?.person
    ? timelineLines(timeline.data?.pages ?? [])
    : [...conversation.events]
        .sort((a, b) => a.at - b.at)
        .map((event) => ({
          id: event.id,
          at: event.at,
          direction: event.direction,
          text: event.text,
        }));

  const run = async (task: () => Promise<unknown>): Promise<boolean> => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await task();
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setStatus = (status: InboxStatus) =>
    run(async () => {
      await api.setStatus(conversation.id, status);
      await invalidate();
    });

  // Secondary status changes live in one menu; the current status is not offered.
  const statusItems = INBOX_STATUSES.filter((status) => status !== item?.status).map((status) => ({
    kind: "item" as const,
    id: status,
    label: t("Mark as {p0}", { p0: statusText(status) }),
  }));
  const pickStatus = (id: string) => {
    setStatusOpen(false);
    void setStatus(id as InboxStatus).catch(() => undefined);
  };

  // A tag change sends one tag delta (add or remove); the Host applies it to the stored list. The
  // `saving` guard keeps a second change from starting while one is in flight.
  const tagsFull = (item?.tags.length ?? 0) >= INBOX_TAGS_MAX;

  const addTag = async () => {
    const tag = tagDraft.trim();
    if (!tag || !item || saving || tagsFull) return;
    if (item.tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    if (await run(async () => applyTags(item, await api.addTag(conversation.id, tag))))
      setTagDraft("");
  };

  const removeTag = (tag: string) => {
    if (!item || saving) return;
    void run(async () => applyTags(item, await api.removeTag(conversation.id, tag)));
  };

  const title = item?.person?.name ?? item?.title ?? conversation.platformThreadId;

  return (
    <article ref={article} className="inbox-conversation">
      <header className="inbox-conversation-head">
        <div className="inbox-conversation-heading">
          {item ? <SocialAvatar name={title} platform={item.platform} size="lg" /> : null}
          <div className="inbox-conversation-who">
            <Heading size="page" level={3} truncate className="inbox-conversation-title">
              {title}
            </Heading>
            {item ? (
              <Text
                size="caption"
                tone="muted"
                leading="inherit"
                className="inbox-conversation-account"
              >
                <PlatformIcon platform={item.platform} className="icon-xs" />
                <Text
                  size="inherit"
                  tone="inherit"
                  leading="inherit"
                  truncate
                  className="inbox-conversation-account-name"
                >
                  {accountName || channelName(item.platform)}
                </Text>
              </Text>
            ) : null}
          </div>
          {item ? (
            <Badge size="sm" tone={statusTone(item.status)}>
              {statusText(item.status)}
            </Badge>
          ) : null}
        </div>
        <div className="inbox-status-actions">
          <Button
            ref={statusButton}
            variant="secondary"
            size="sm"
            disabled={saving}
            aria-haspopup="menu"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((open) => !open)}
          >
            {t("Change status")}
          </Button>
          {statusOpen ? (
            <DropdownMenu
              anchor={statusButton}
              label={t("Conversation status")}
              returnFocusRef={statusButton}
              onClose={() => setStatusOpen(false)}
              items={statusItems}
              onPick={pickStatus}
            />
          ) : null}
        </div>
      </header>
      {item?.platform === "linkedin" &&
      conversation.kind === "comment" &&
      conversation.platformThreadId.startsWith("urn:li:comment:") ? (
        <LinkedInCommentActions key={conversation.id} client={client} thread={conversation} />
      ) : null}

      {item ? (
        <div className="inbox-tag-editor">
          {item.tags.map((tag) => (
            <Badge
              key={tag}
              size="sm"
              truncate
              onRemove={() => removeTag(tag)}
              removeLabel={t("Remove {p0}", { p0: tag })}
            >
              {tag}
            </Badge>
          ))}
          <TextField
            label={t("Add tag")}
            hideLabel
            fieldClassName="inbox-tag-field"
            value={tagDraft}
            maxLength={INBOX_TAG_MAX_LENGTH}
            disabled={saving || tagsFull}
            placeholder={t("Add tag")}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) {
                event.preventDefault();
                void addTag().catch(() => undefined);
              }
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={saving || tagsFull || !tagDraft.trim()}
            disabledReason={
              tagsFull
                ? t("This conversation has the most tags it can have.")
                : saving
                  ? t("Wait for the current action to finish.")
                  : t("Enter a tag first.")
            }
            onClick={() => void addTag().catch(() => undefined)}
          >
            {t("Add")}
          </Button>
        </div>
      ) : null}

      {thread.isError ? (
        <InlineError
          retry={{
            label: t("Try again"),
            pending: thread.isFetching,
            onRetry: () => {
              void thread.refetch().catch(() => undefined);
            },
          }}
        >
          {t("This conversation could not be opened.")}
        </InlineError>
      ) : null}
      {item?.person && timeline.isError && !timeline.data ? (
        <InlineError
          retry={{
            label: t("Try again"),
            pending: timeline.isFetching,
            onRetry: () => {
              void timeline.refetch().catch(() => undefined);
            },
          }}
        >
          {t("Could not load the timeline.")}
        </InlineError>
      ) : null}
      {saveFailed ? <InlineError>{t("Could not save this change. Try again.")}</InlineError> : null}

      {item?.person && timeline.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          loading={timeline.isFetchingNextPage}
          onClick={() => {
            void loadOlder().catch(() => undefined);
          }}
        >
          {t("Load older messages")}
        </Button>
      ) : null}
      {item?.person && timeline.data && !timeline.hasNextPage && timeline.data.pages.length > 1 ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="inbox-note">
          {t("No older messages.")}
        </Text>
      ) : null}
      {item?.person && timeline.isFetchNextPageError ? (
        <InlineError
          retry={{
            label: t("Try again"),
            pending: timeline.isFetchingNextPage,
            onRetry: () => {
              void loadOlder().catch(() => undefined);
            },
          }}
        >
          {t("Could not load older messages.")}
        </InlineError>
      ) : null}

      <MessageTimeline lines={lines} />
      {item?.person && timeline.isPending ? (
        <LoadingText>{t("Loading conversation…")}</LoadingText>
      ) : null}
      {lines.length === 0 && (!item?.person || (timeline.isSuccess && !timeline.isError)) ? (
        <EmptyState
          size="inline"
          kind="empty"
          className="inbox-note"
          description={t("No messages in this conversation yet.")}
        />
      ) : null}

      {conversation.instagramSource === "live_comment" ? (
        <Text size="caption" tone="muted">
          {t("Instagram Live comment")}
        </Text>
      ) : null}
      {instagram && conversation.kind === "comment" ? (
        <InstagramCommentActions
          key={conversation.id}
          client={client}
          account={instagram}
          thread={conversation}
        />
      ) : null}
      <ReplyBox key={conversation.id} client={client} thread={conversation} />
    </article>
  );
}
