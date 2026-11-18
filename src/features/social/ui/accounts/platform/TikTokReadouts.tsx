import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialInbound } from "../../../../../integrations/social/adapter";
import { useAccountWrite } from "../useAccountWrite";
import type { TikTokPanelProps } from "./TikTokAccountTools";
import type { TikTokChange } from "./TikTokChanges";

type View = "analytics" | "earnings" | "comments" | "mentions" | "messages" | "followers" | "live";
type Metrics = { views?: number; likes?: number; comments?: number; shares?: number; reach?: number };
type PostMetrics = {
  posts: { id: string; text?: string }[];
  metrics: Record<string, Metrics>;
  next?: number;
};
type Result =
  | { source: "studio"; period?: string; metrics: { key: string; displayValue: string }[] }
  | ({ source: "business"; followers?: number; likes?: number } & PostMetrics)
  | ({ source: "display" } & PostMetrics)
  | { events: SocialInbound[]; coverage?: { status: string }[] }
  | {
      comments: { id: string; postId: string; author?: string; username?: string; text: string }[];
      next?: number;
    }
  | { people: { platformId: string; username: string; name: string }[] }
  | { credentialSaved: boolean; eligible: boolean }
  | { ingested: number };

export function TikTokReadouts({
  client,
  accountId,
  disabled,
  view,
  selectChange,
  onChanged,
  businessConnected,
}: TikTokPanelProps & {
  view: View;
  selectChange(change: TikTokChange): void;
  onChanged(): void;
  businessConnected: boolean;
}) {
  const t = useT();
  const format = useFormat();
  const { is, write, error } = useAccountWrite(t("Could not complete the TikTok request."));
  const [result, setResult] = useState<Result>();
  const [syncCount, setSyncCount] = useState<number>();
  const [relationship, setRelationship] = useState<"followers" | "following">("followers");
  const [postId, setPostId] = useState("");
  const labels = {
    analytics: t("Read analytics"),
    earnings: t("Read earnings"),
    comments: t("Read comments"),
    mentions: t("Read mentions"),
    messages: t("Read direct messages"),
    followers: t("Read audience"),
    live: t("Save stream key"),
  };
  const metrics: Record<string, string> = {
    postViews: t("Post views"),
    profileViews: t("Profile views"),
    likes: t("Likes"),
    comments: t("Comments"),
    shares: t("Shares"),
    totalFollowers: t("Total followers"),
    netFollowers: t("Net followers"),
    estimatedRewards: t("Estimated rewards"),
    monthlyEarnings: t("Monthly earnings"),
    balance: t("Rewards balance"),
    liveGifts: t("LIVE gifts"),
    diamonds: t("Diamonds"),
  };
  const actions: Record<View, string> = {
    analytics: "tiktok.analytics.read",
    earnings: "tiktok.earnings.read",
    comments: "tiktok.comments.list",
    mentions: "tiktok.mentions.list",
    messages: "tiktok.messages.list",
    followers: "tiktok.audience.list",
    live: "tiktok.live.setup",
  };
  const busy = is("read") || is("sync");
  const businessComments = view === "comments" && businessConnected;
  const read = async () => {
    const next = await write("read", () =>
      client.request<Result>(actions[view], {
        accountId,
        ...(view === "followers" ? { kind: relationship } : {}),
        ...(businessComments ? { postId } : {}),
      }),
    );
    if (next) setResult(next);
  };
  const sync = async () => {
    const next = await write("sync", () =>
      client.request<{ ingested: number }>(
        view === "comments" ? "tiktok.comments.sync" : "tiktok.messages.sync",
        { accountId },
      ),
    );
    if (next) {
      setSyncCount(next.ingested);
      onChanged();
    }
  };
  const empty = <EmptyState context="list" size="inline" title={t("No results")} />;
  const commentAction = (
    postId: string,
    commentId: string,
    recipientId: string,
    kind: TikTokChange["kind"],
  ) => (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={() => selectChange({ kind, postId, commentId, recipientId })}
    >
      {kind === "comment.reply" ? t("Reply to comment") : t("Manage comment")}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {view === "followers" && (
        <Select
          label={t("Audience")}
          value={relationship}
          disabled={disabled || busy}
          options={[
            { value: "followers", label: t("Followers") },
            { value: "following", label: t("Following") },
          ]}
          onValueChange={(value) => {
            setRelationship(value === "following" ? "following" : "followers");
            setResult(undefined);
          }}
        />
      )}
      {businessComments && (
        <TextField
          label={t("TikTok post ID")}
          value={postId}
          disabled={disabled || busy}
          inputMode="numeric"
          maxLength={30}
          onChange={(event) => {
            setPostId(event.currentTarget.value);
            setResult(undefined);
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={is("read")}
          disabled={disabled || busy || (businessComments && !/^\d{1,30}$/.test(postId))}
          onClick={() => read().catch(() => undefined)}
        >
          {labels[view]}
        </Button>
        {((view === "comments" && !businessConnected) || view === "messages") && (
          <Button
            size="sm"
            variant="secondary"
            loading={is("sync")}
            disabled={disabled || busy}
            onClick={() => sync().catch(() => undefined)}
          >
            {t("Sync to inbox")}
          </Button>
        )}
        {view === "live" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || busy}
            onClick={() => selectChange({ kind: "live.reply" })}
          >
            {t("Reply to LIVE comment")}
          </Button>
        )}
      </div>
      {syncCount !== undefined && (
        <InlineMessage tone="success">
          {t("Imported items: {p0}", { p0: format.formatNumber(syncCount) })}
        </InlineMessage>
      )}
      {error && <InlineError>{error}</InlineError>}
      {result && "credentialSaved" in result && result.credentialSaved && (
        <InlineMessage tone="success">{t("Stream key saved on this Host.")}</InlineMessage>
      )}
      {result &&
        "source" in result &&
        result.source === "studio" &&
        (result.metrics.length ? (
          <DescriptionList size="sm">
            {result.period && <DescriptionItem term={t("Period")}>{result.period}</DescriptionItem>}
            {result.metrics.map(({ key, displayValue }) => (
              <DescriptionItem key={key} term={metrics[key] ?? key}>
                {displayValue}
              </DescriptionItem>
            ))}
          </DescriptionList>
        ) : (
          <EmptyState context="list" size="inline" title={t("Earnings unavailable")} />
        ))}
      {result &&
        "source" in result &&
        result.source === "business" &&
        (result.followers !== undefined || result.likes !== undefined) && (
          <DescriptionList size="sm">
            {result.followers !== undefined && (
              <DescriptionItem term={t("Followers")}>
                {format.formatNumber(result.followers)}
              </DescriptionItem>
            )}
            {result.likes !== undefined && (
              <DescriptionItem term={t("Likes")}>
                {format.formatNumber(result.likes)}
              </DescriptionItem>
            )}
          </DescriptionList>
        )}
      {result && "posts" in result && result.next !== undefined && (
        <InlineMessage tone="info">{t("TikTok only returned part of the activity.")}</InlineMessage>
      )}
      {result &&
        "posts" in result &&
        (result.posts.length
          ? result.posts.map((post) => {
              const values = result.metrics[post.id] ?? {};
              return (
                <div key={post.id} className="flex min-w-0 flex-col gap-1">
                  <Text weight="medium">{post.text || post.id}</Text>
                  <DescriptionList size="sm">
                    {values.views !== undefined && (
                      <DescriptionItem term={t("Views")}>
                        {format.formatNumber(values.views)}
                      </DescriptionItem>
                    )}
                    {values.likes !== undefined && (
                      <DescriptionItem term={t("Likes")}>
                        {format.formatNumber(values.likes)}
                      </DescriptionItem>
                    )}
                    {values.comments !== undefined && (
                      <DescriptionItem term={t("Comments")}>
                        {format.formatNumber(values.comments)}
                      </DescriptionItem>
                    )}
                    {values.shares !== undefined && (
                      <DescriptionItem term={t("Shares")}>
                        {format.formatNumber(values.shares)}
                      </DescriptionItem>
                    )}
                    {values.reach !== undefined && (
                      <DescriptionItem term={t("Reach")}>
                        {format.formatNumber(values.reach)}
                      </DescriptionItem>
                    )}
                  </DescriptionList>
                </div>
              );
            })
          : empty)}
      {result &&
        "people" in result &&
        (result.people.length
          ? result.people.map((person) => (
              <div key={person.platformId} className="flex flex-wrap items-center gap-2">
                <Text>
                  {person.name} @{person.username}
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    selectChange({
                      kind: relationship === "followers" ? "follow" : "unfollow",
                      recipientId: person.platformId,
                    })
                  }
                >
                  {relationship === "followers" ? t("Follow") : t("Unfollow")}
                </Button>
              </div>
            ))
          : empty)}
      {result && "events" in result && (
        <>
          {result.coverage?.some(({ status }) => status === "partial") && (
            <InlineMessage tone="info">
              {t("TikTok only returned part of the activity.")}
            </InlineMessage>
          )}
          {result.events.length
            ? result.events.map((event) => (
                <div key={event.eventId} className="flex min-w-0 flex-col gap-1">
                  <Text weight="medium">{event.contactName}</Text>
                  <Text tone="secondary" size="caption">
                    {format.formatDate(event.at, { dateStyle: "medium", timeStyle: "short" })}
                  </Text>
                  <Text>{event.text}</Text>
                  {view === "comments" && event.postId && (
                    <div className="flex flex-wrap gap-2">
                      {commentAction(event.postId, event.threadId, event.contactId, "comment.like")}
                    </div>
                  )}
                </div>
              ))
            : empty}
        </>
      )}
      {result && "comments" in result && (
        <>
          {result.next !== undefined && (
            <InlineMessage tone="info">
              {t("TikTok only returned part of the activity.")}
            </InlineMessage>
          )}
          {result.comments.length
            ? result.comments.map((comment) => (
                <div key={comment.id} className="flex min-w-0 flex-col gap-1">
                  <Text weight="medium">{comment.author ?? comment.username ?? comment.id}</Text>
                  <Text>{comment.text}</Text>
                  {view === "comments" && comment.username && (
                    <div className="flex flex-wrap gap-2">
                      {commentAction(
                        comment.postId,
                        comment.id,
                        `web:tiktok:${comment.username}`,
                        "comment.reply",
                      )}
                      {commentAction(
                        comment.postId,
                        comment.id,
                        `web:tiktok:${comment.username}`,
                        "comment.like",
                      )}
                    </div>
                  )}
                </div>
              ))
            : empty}
        </>
      )}
    </div>
  );
}
