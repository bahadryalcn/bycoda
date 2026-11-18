import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { StatRow, StatTile } from "../../../../../shared/ui/StatTile";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import type { readFacebookPageInsights } from "../../../../../integrations/social/adapters/facebook-insights";
import type { SocialAdapter } from "../../../../../integrations/social/adapter";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "../accounts.css";
import "./facebook.css";

type PostPage = Awaited<ReturnType<NonNullable<SocialAdapter["listPosts"]>>>;
type InsightsPage = Awaited<ReturnType<typeof readFacebookPageInsights>>;

export function FacebookPageActivity({
  client,
  accountId,
  mentions = false,
}: {
  client: SocialClient;
  accountId: string;
  mentions?: boolean;
}) {
  const t = useT();
  const format = useFormat();
  const work = useAccountWrite(t("Could not load this view."));
  const confirm = useConfirm();
  const [page, setPage] = useState<PostPage>();
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const [analytics, setAnalytics] = useState<
    Record<string, InsightsPage | Record<string, number | undefined>>
  >({});

  const load = async (cursor?: string) => {
    const result = await work.write("list", () =>
      client.request<PostPage>(mentions ? "facebook.mentions.list" : "facebook.posts.list", {
        accountId,
        ...(cursor ? { cursor } : {}),
      }),
    );
    if (result)
      setPage((previous) =>
        cursor && previous
          ? {
              ...result,
              posts: [
                ...new Map(
                  [...previous.posts, ...result.posts].map((post) => [post.id, post]),
                ).values(),
              ],
            }
          : result,
      );
  };
  const mutate = async (post: PostPage["posts"][number], remove: boolean) => {
    const text = editing?.text.trim();
    if (
      await confirm.confirm({
        title: remove ? t("Delete post") : t("Edit post"),
        message: (remove ? post.text : text) || post.id,
        confirmLabel: remove ? t("Delete") : t("Save"),
        danger: remove,
      })
    ) {
      const updated = await work.write(post.id, async () => {
        await client.request(remove ? "facebook.post.delete" : "facebook.post.edit", {
          accountId,
          postId: post.id,
          ...(remove ? {} : { text }),
          confirm: remove ? "DELETE_FACEBOOK_POST" : "EDIT_FACEBOOK_POST",
        });
        return true;
      });
      if (updated) {
        setEditing(undefined);
        setPage(
          (current) =>
            current && {
              ...current,
              posts: remove
                ? current.posts.filter((row) => row.id !== post.id)
                : current.posts.map((row) => (row.id === post.id ? { ...row, text } : row)),
            },
        );
      }
    }
  };
  const stats = async (postId?: string) => {
    const key = postId ?? "";
    const result = await work.write(`stats:${key}`, () =>
      client.request<Record<string, Record<string, number>> & InsightsPage>(
        "facebook.insights.read",
        { accountId, ...(postId ? { postIds: [postId] } : {}) },
      ),
    );
    if (result)
      setAnalytics((current) => ({ ...current, [key]: postId ? result[postId] : result }));
  };

  const pageStats = analytics[""] as InsightsPage | undefined;
  const number = (value?: number) =>
    typeof value === "number" ? format.formatNumber(value) : t("Unavailable");
  return (
    <section className="social-fb-stack" aria-label={mentions ? t("Mentions") : t("Posts")}>
      <div className="social-fb-toolbar">
        <Button
          size="sm"
          variant={page ? "secondary" : "primary"}
          loading={work.is("list")}
          onClick={() => void load().catch(() => undefined)}
        >
          {page ? t("Refresh") : mentions ? t("Load mentions") : t("Load posts")}
        </Button>
        {!mentions ? (
          <Button
            size="sm"
            variant="secondary"
            loading={work.is("stats:")}
            onClick={() => void stats().catch(() => undefined)}
          >
            {t("Page insights")}
          </Button>
        ) : null}
      </div>
      {pageStats ? (
        <StatRow label={t("Page insights")}>
          {pageStats.metrics.map((metric) => (
            <StatTile
              key={metric.name}
              label={metric.name === "page_media_view" ? t("Views") : t("Unique viewers")}
              value={number(metric.values[metric.values.length - 1]?.value as number | undefined)}
            />
          ))}
        </StatRow>
      ) : null}
      {!page && work.is("list") ? <LoadingText>{t("Loading…")}</LoadingText> : null}
      {!page && !work.is("list") && !work.error ? (
        <Text as="p" size="secondary" tone="muted">
          {mentions
            ? t("Load mentions to see where people tagged this Page.")
            : t("Load posts to edit, delete or measure them.")}
        </Text>
      ) : null}
      {page && !page.posts.length ? (
        <EmptyState
          size="inline"
          description={mentions ? t("No mentions yet.") : t("No posts yet.")}
        />
      ) : null}
      {page?.posts.length ? (
        <ul className="social-fb-list">
          {page.posts.map((post) => {
            const metrics = analytics[post.id] as Record<string, number | undefined> | undefined;
            const isEditing = editing?.id === post.id;
            return (
              <Surface key={post.id} as="li" variant="card" padding="sm" className="social-fb-item">
                {isEditing ? (
                  <TextareaField
                    label={t("Edit post")}
                    value={editing.text}
                    onChange={(event) =>
                      setEditing({ id: post.id, text: event.currentTarget.value })
                    }
                  />
                ) : (
                  <Text as="p" className="social-fb-item-title">
                    {post.text || post.id}
                  </Text>
                )}
                {metrics ? (
                  <DescriptionList size="sm" columns="auto">
                    <DescriptionItem term={t("Views")}>{number(metrics.views)}</DescriptionItem>
                    <DescriptionItem term={t("Likes")}>{number(metrics.likes)}</DescriptionItem>
                    <DescriptionItem term={t("Comments")}>
                      {number(metrics.comments)}
                    </DescriptionItem>
                    <DescriptionItem term={t("Shares")}>{number(metrics.shares)}</DescriptionItem>
                  </DescriptionList>
                ) : null}
                {!mentions ? (
                  <div className="social-fb-actions">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!editing.text.trim()}
                          loading={work.is(post.id)}
                          onClick={() => void mutate(post, false).catch(() => undefined)}
                        >
                          {t("Save")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>
                          {t("Cancel")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing({ id: post.id, text: post.text ?? "" })}
                        >
                          {t("Edit post")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={work.is(`stats:${post.id}`)}
                          onClick={() => void stats(post.id).catch(() => undefined)}
                        >
                          {t("Analytics")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          tone="danger"
                          loading={work.is(post.id)}
                          onClick={() => void mutate(post, true).catch(() => undefined)}
                        >
                          {t("Delete")}
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </Surface>
            );
          })}
        </ul>
      ) : null}
      {page?.next ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          loading={work.is("list")}
          onClick={() => void load(page.next).catch(() => undefined)}
        >
          {t("Load more")}
        </Button>
      ) : null}
      {work.error ? <InlineError>{work.error}</InlineError> : null}
      {confirm.dialog}
    </section>
  );
}
