import { StatusDot } from "../../../../shared/ui/StatusDot";
import { Text } from "../../../../shared/ui/Text";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { SocialAvatar } from "../common/SocialAvatar";
import { statusText, statusTone } from "./inboxModel";
import type { InboxItem } from "./inboxTypes";
import "./inbox.css";

/** Compact conversation list. One row per thread, comments and messages from every account mixed. */
export function InboxList({
  items,
  selectedId,
  loading,
  hasMore,
  loadingMore,
  onSelect,
  onMore,
}: {
  items: InboxItem[];
  selectedId?: string;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect(threadId: string): void;
  onMore(): void;
}) {
  if (loading) return <LoadingText>{t("Loading conversations…")}</LoadingText>;
  return (
    <div className="inbox-list">
      <ul className="inbox-rows">
        {items.map((item) => {
          const selected = item.threadId === selectedId;
          const unread = item.status === "unread";
          const name = item.person?.name ?? item.title;
          return (
            <li key={item.threadId}>
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
                    {unread ? <StatusDot /> : null}
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
                  <span className="inbox-row-meta">
                    <Badge size="xs" tone={statusTone(item.status)}>
                      {statusText(item.status)}
                    </Badge>
                    {item.tags.map((tag) => (
                      <Badge key={tag} size="xs">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <Button variant="secondary" size="sm" disabled={loadingMore} onClick={onMore}>
          {t("Load more")}
        </Button>
      ) : null}
    </div>
  );
}
