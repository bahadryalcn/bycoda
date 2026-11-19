import { StatusDot } from "../../../../shared/ui/StatusDot";
import { Text } from "../../../../shared/ui/Text";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { BadgeList } from "../../../../shared/ui/BadgeList";
import { Button } from "../../../../shared/ui/Button";
import { ContinuousList } from "../../../../shared/ui/ContinuousList";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { SocialAvatar } from "../common/SocialAvatar";
import { statusText, statusTone } from "./inboxModel";
import type { InboxItem } from "./inboxTypes";
import "./inbox.css";

/** Typical row height with a two-line preview and a tag line; the virtualizer measures the real rows. */
const ROW_ESTIMATE = 96;

/**
 * One conversation. The tags sit beside the row button, not inside it: the "+N" overflow is a
 * button of its own, and a button cannot nest in a button. Unread shows once, as a named dot.
 */
function InboxRow({
  item,
  selected,
  onSelect,
}: {
  item: InboxItem;
  selected: boolean;
  onSelect(threadId: string): void;
}) {
  const unread = item.status === "unread";
  const name = item.person?.name ?? item.title;
  return (
    <div className="inbox-row-item">
      <Button
        variant="item"
        layout="inline"
        className="inbox-row"
        selected={selected}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(item.threadId)}
      >
        <SocialAvatar name={name} platform={item.platform} size="md" />
        <span className="inbox-row-body">
          <span className="inbox-row-top">
            {unread ? <StatusDot label={t("Unread")} /> : null}
            <Text
              as="span"
              size="secondary"
              tone={unread ? "primary" : "secondary"}
              weight={unread ? "medium" : "regular"}
              truncate
              className="inbox-row-title"
              data-unread={unread || undefined}
            >
              {name}
            </Text>
            <Timestamp
              className="inbox-row-time"
              size="caption"
              tone="muted"
              leading="inherit"
              value={item.at}
              format="relative"
            />
          </span>
          {item.person && item.title !== name && item.title !== item.preview ? (
            <Text
              size="secondary"
              tone="secondary"
              leading="inherit"
              truncate
              className="inbox-row-subject"
            >
              {item.title}
            </Text>
          ) : null}
          <Text
            size="caption"
            tone="muted"
            leading="inherit"
            truncate
            className="inbox-row-preview"
          >
            {item.preview}
          </Text>
          {unread ? null : (
            <span className="inbox-row-meta">
              <Badge size="xs" tone={statusTone(item.status)}>
                {statusText(item.status)}
              </Badge>
            </span>
          )}
        </span>
      </Button>
      {item.tags.length > 0 ? (
        <BadgeList
          className="inbox-row-tags"
          label={t("Tags")}
          size="xs"
          items={item.tags.map((tag) => ({ id: tag, label: tag }))}
        />
      ) : null}
    </div>
  );
}

/** Compact conversation list. One row per thread, comments and messages from every account mixed. */
export function InboxList({
  items,
  selectedId,
  stateKey,
  loading,
  hasMore,
  loadingMore,
  onSelect,
  onMore,
}: {
  items: InboxItem[];
  selectedId?: string;
  /** Scopes the window and retained scroll: account and status filters, not the search text. */
  stateKey: string;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect(threadId: string): void;
  onMore(): void;
}) {
  if (loading) return <LoadingText>{t("Loading conversations…")}</LoadingText>;
  return (
    <div className="inbox-list">
      <ContinuousList
        fill
        label={t("Conversations")}
        items={items}
        itemKey={(item) => item.threadId}
        stateKey={stateKey}
        requiredKey={selectedId ?? null}
        estimateSize={ROW_ESTIMATE}
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onMore}
        renderItem={(item) => (
          <InboxRow
            item={item}
            selected={item.threadId === selectedId}
            onSelect={onSelect}
          />
        )}
      />
    </div>
  );
}
