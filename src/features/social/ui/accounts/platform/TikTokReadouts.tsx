import { accountBlockedReason } from "../blockedReason";
import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialInbound } from "../../../../../integrations/social/adapter";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { useAccountWrite } from "../useAccountWrite";
import type { TikTokPanelProps } from "./TikTokAccountTools";
import type { TikTokChange } from "./TikTokChanges";
import { TikTokPostSelect } from "./TikTokPostSelect";
import { TikTokRow, TikTokRows } from "./TikTokRows";
import "./tiktok.css";

const TIKTOK_STUDIO_COMMENTS = "https://www.tiktok.com/tiktokstudio/comments";

type View = "analytics" | "earnings" | "comments" | "mentions" | "messages" | "followers" | "live";
type Metrics = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
};
type PostMetrics = {
  posts: { id: string; text?: string }[];
  metrics: Record<string, Metrics>;
  next?: number;
};
type Result =
  | {
      source: "studio";
      period?: string;
      metrics: { key: string; displayValue: string }[];
    }
  | ({ source: "business"; followers?: number; likes?: number } & PostMetrics)
  | ({ source: "display" } & PostMetrics)
  | { events: SocialInbound[]; coverage?: { status: string }[] }
  | {
      comments: {
        id: string;
        postId: string;
        author?: string;
        username?: string;
        text: string;
      }[];
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
  const { is, write, failureTitle, details } = useAccountWrite(
    t("Could not complete the TikTok request."),
  );
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
  const titles = {
    analytics: t("Analytics"),
    earnings: t("Earnings"),
    comments: t("Comments"),
    mentions: t("Mentions"),
    messages: t("Direct messages"),
    followers: t("Audience"),
    live: t("TikTok LIVE"),
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
  ) =>
    // Replies need a TikTok for Business connection; without it the owner replies on the exact Studio page.
    kind === "comment.reply" && !businessConnected ? (
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        disabledReason={accountBlockedReason(disabled)}
        onClick={() => {
          openExternal(TIKTOK_STUDIO_COMMENTS).catch(() => undefined);
        }}
      >
        {t("Reply in TikTok Studio")}
      </Button>
    ) : (
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        disabledReason={accountBlockedReason(disabled)}
        onClick={() => selectChange({ kind, postId, commentId, recipientId })}
      >
        {kind === "comment.reply" ? t("Reply to comment") : t("Manage comment")}
      </Button>
    );
  const postMetrics = (values: Metrics) =>
    [
      values.views !== undefined && `${t("Views")} ${format.formatNumber(values.views)}`,
      values.likes !== undefined && `${t("Likes")} ${format.formatNumber(values.likes)}`,
      values.comments !== undefined && `${t("Comments")} ${format.formatNumber(values.comments)}`,
      values.shares !== undefined && `${t("Shares")} ${format.formatNumber(values.shares)}`,
      values.reach !== undefined && `${t("Reach")} ${format.formatNumber(values.reach)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const partial = (
    <InlineMessage tone="info">{t("TikTok only returned part of the activity.")}</InlineMessage>
  );

  return (
    <div className="tiktok-panel">
      <div className="tiktok-head">
        <SectionLabel as="h3">{titles[view]}</SectionLabel>
        <div className="tiktok-actions">
          <Button
            size="sm"
            variant="secondary"
            loading={is("read")}
            disabled={disabled || busy || (businessComments && !/^\d{1,30}$/.test(postId))}
            disabledReason={
              disabled || busy
                ? accountBlockedReason(disabled)
                : t("Enter a numeric post ID first.")
            }
            onClick={() => read().catch(() => undefined)}
          >
            {result && view !== "live" ? t("Refresh") : labels[view]}
          </Button>
          {((view === "comments" && !businessConnected) || view === "messages") && (
            <Button
              size="sm"
              variant="ghost"
              loading={is("sync")}
              disabled={disabled || busy}
              disabledReason={accountBlockedReason(disabled)}
              onClick={() => sync().catch(() => undefined)}
            >
              {t("Sync to inbox")}
            </Button>
          )}
          {view === "live" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              disabledReason={accountBlockedReason(disabled)}
              onClick={() => selectChange({ kind: "live.reply" })}
            >
              {t("Reply to LIVE comment")}
            </Button>
          )}
        </div>
      </div>
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
        <>
          <TikTokPostSelect
            client={client}
            accountId={accountId}
            disabled={disabled || busy}
            value={postId}
            onChange={(next) => {
              setPostId(next);
              setResult(undefined);
            }}
          />
          <Disclosure variant="plain" summary={t("Enter an ID instead")}>
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
          </Disclosure>
        </>
      )}
      {is("read") && !result && <LoadingText />}
      {!result && !busy && !failureTitle && (
        <Text size="caption" tone="secondary">
          {businessComments && !postId
            ? t("Choose a post to read its comments.")
            : view === "live"
              ? t("Save the stream key from your TikTok LIVE setup to go live from this Host.")
              : t("Nothing loaded yet. Read it from TikTok to see it here.")}
        </Text>
      )}
      {syncCount !== undefined && (
        <InlineMessage tone="success">
          {t("Imported items: {p0}", { p0: format.formatNumber(syncCount) })}
        </InlineMessage>
      )}
      {failureTitle && <InlineError details={details}>{failureTitle}</InlineError>}
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
      {result && "posts" in result && result.next !== undefined && partial}
      {result &&
        "posts" in result &&
        (result.posts.length ? (
          <TikTokRows>
            {result.posts.map((post) => (
              <TikTokRow
                key={post.id}
                title={post.text || post.id}
                meta={postMetrics(result.metrics[post.id] ?? {})}
              />
            ))}
          </TikTokRows>
        ) : (
          empty
        ))}
      {result &&
        "people" in result &&
        (result.people.length ? (
          <TikTokRows>
            {result.people.map((person) => (
              <TikTokRow key={person.platformId} title={person.name} meta={`@${person.username}`}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  disabledReason={accountBlockedReason(disabled)}
                  onClick={() =>
                    selectChange({
                      kind: relationship === "followers" ? "follow" : "unfollow",
                      recipientId: person.platformId,
                    })
                  }
                >
                  {relationship === "followers" ? t("Follow") : t("Unfollow")}
                </Button>
              </TikTokRow>
            ))}
          </TikTokRows>
        ) : (
          empty
        ))}
      {result && "events" in result && (
        <>
          {result.coverage?.some(({ status }) => status === "partial") && partial}
          {result.events.length ? (
            <TikTokRows>
              {result.events.map((event) => (
                <TikTokRow
                  key={event.eventId}
                  title={event.contactName}
                  meta={format.formatDate(event.at, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  body={event.text}
                >
                  {view === "comments" &&
                    event.postId &&
                    commentAction(event.postId, event.threadId, event.contactId, "comment.like")}
                </TikTokRow>
              ))}
            </TikTokRows>
          ) : (
            empty
          )}
        </>
      )}
      {result && "comments" in result && (
        <>
          {result.next !== undefined && partial}
          {result.comments.length ? (
            <TikTokRows>
              {result.comments.map((comment) => (
                <TikTokRow
                  key={comment.id}
                  title={comment.author ?? comment.username ?? comment.id}
                  body={comment.text}
                >
                  {view === "comments" &&
                    comment.username &&
                    (["comment.reply", "comment.like"] as const).map((kind) => (
                      <span key={kind}>
                        {commentAction(
                          comment.postId,
                          comment.id,
                          `web:tiktok:${comment.username}`,
                          kind,
                        )}
                      </span>
                    ))}
                </TikTokRow>
              ))}
            </TikTokRows>
          ) : (
            empty
          )}
        </>
      )}
    </div>
  );
}
