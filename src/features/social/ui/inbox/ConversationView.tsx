import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Text } from "../../../../shared/ui/Text";
import { useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialClient } from "../../model/socialClient";
import { EmptyHint } from "../common/EmptyHint";
import { channelName, PlatformIcon } from "../common/PlatformIcon";
import { SocialAvatar } from "../common/SocialAvatar";
import { inboxApi } from "./inboxApi";
import { statusText, statusTone, type MessageLine } from "./inboxModel";
import { MessageTimeline } from "./MessageTimeline";
import { INBOX_STATUSES, type InboxItem, type InboxStatus } from "./inboxTypes";
import { ReplyBox } from "./ReplyBox";
import { useInboxInvalidate, useInboxThread, useInboxTimeline } from "./useInboxData";
import "./inbox.css";

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
  const invalidate = useInboxInvalidate(client);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const statusButton = useRef<HTMLButtonElement>(null);

  if (!threadId) return <EmptyHint message={t("Choose a conversation to read and reply.")} />;
  if (thread.isPending) return <LoadingText>{t("Loading conversation…")}</LoadingText>;
  if (!thread.data) return <InlineError>{t("This conversation could not be opened.")}</InlineError>;

  const conversation = thread.data;
  const lines: MessageLine[] = item?.person
    ? (timeline.data?.events ?? []).map((event) => ({
        id: event.id,
        at: event.at,
        direction: event.direction,
        text: event.text,
      }))
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
    setError("");
    try {
      await task();
      await invalidate();
      return true;
    } catch {
      setError(t("Could not save this change. Try again."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setStatus = (status: InboxStatus) =>
    run(() => api.setStatus(conversation.id, status, item?.tags));

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

  const addTag = async () => {
    const tag = tagDraft.trim();
    if (!tag || !item) return;
    if (item.tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    if (await run(() => api.setStatus(conversation.id, item.status, [...item.tags, tag])))
      setTagDraft("");
  };

  const title = item?.person?.name ?? item?.title ?? conversation.platformThreadId;

  return (
    <article className="inbox-conversation">
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
                  {[channelName(item.platform), accountName].filter(Boolean).join(" · ")}
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

      {item ? (
        <div className="inbox-tag-editor">
          {item.tags.map((tag) => (
            <Badge key={tag} size="sm">
              {tag}
            </Badge>
          ))}
          <TextField
            label={t("Add tag")}
            hideLabel
            fieldClassName="inbox-tag-field"
            value={tagDraft}
            disabled={saving}
            placeholder={t("Add tag")}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addTag().catch(() => undefined);
              }
            }}
          />
        </div>
      ) : null}

      {item?.person && timeline.isError ? (
        <InlineError>{t("Could not load the timeline.")}</InlineError>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}

      <MessageTimeline lines={lines} />
      {lines.length === 0 ? (
        <EmptyState
          size="inline"
          kind="empty"
          className="inbox-note"
          description={t("No messages in this conversation yet.")}
        />
      ) : null}
      {timeline.data?.truncated ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="inbox-note">
          {t("Older messages are not shown.")}
        </Text>
      ) : null}

      <ReplyBox key={conversation.id} client={client} thread={conversation} />
    </article>
  );
}
