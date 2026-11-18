import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import type { readFacebookPageInsights } from "../../../../../integrations/social/adapters/facebook-insights";
import type { SocialAdapter } from "../../../../../integrations/social/adapter";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

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
  return (
    <section className="social-card" aria-label={mentions ? t("Mentions") : t("Posts")}>
      <div className="social-field-row">
        <Button
          size="sm"
          variant="secondary"
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
      {pageStats?.metrics.map((metric) => {
        const value = metric.values[metric.values.length - 1]?.value;
        return (
          <Text key={metric.name} as="p">
            {metric.name === "page_media_view" ? t("Views") : t("Unique viewers")}{" "}
            {typeof value === "number" ? format.formatNumber(value) : t("Unavailable")}
          </Text>
        );
      })}
      {page && !page.posts.length ? (
        <EmptyState size="inline" description={t("No results")} />
      ) : null}
      {page?.posts.map((post) => {
        const metrics = analytics[post.id] as Record<string, number | undefined> | undefined;
        return (
          <div className="social-card" key={post.id}>
            <Text as="p" className="social-card-description">
              {post.text || post.id}
            </Text>
            {editing?.id === post.id ? (
              <TextareaField
                label={t("Edit post")}
                value={editing.text}
                onChange={(event) => setEditing({ id: post.id, text: event.currentTarget.value })}
              />
            ) : null}
            {!mentions ? (
              <div className="social-field-row">
                {editing?.id === post.id ? (
                  <>
                    <Button
                      size="sm"
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
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing({ id: post.id, text: post.text ?? "" })}
                  >
                    {t("Edit post")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={work.is(post.id)}
                  onClick={() => void mutate(post, true).catch(() => undefined)}
                >
                  {t("Delete")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={work.is(`stats:${post.id}`)}
                  onClick={() => void stats(post.id).catch(() => undefined)}
                >
                  {t("Analytics")}
                </Button>
              </div>
            ) : null}
            {metrics ? (
              <InlineMessage tone="info">
                {[
                  [t("Views"), metrics.views],
                  [t("Likes"), metrics.likes],
                  [t("Comments"), metrics.comments],
                  [t("Shares"), metrics.shares],
                ]
                  .map(
                    ([label, value]) =>
                      `${label} ${typeof value === "number" ? format.formatNumber(value) : t("Unavailable")}`,
                  )
                  .join(" · ")}
              </InlineMessage>
            ) : null}
          </div>
        );
      })}
      {page?.next ? (
        <Button
          size="sm"
          variant="secondary"
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
