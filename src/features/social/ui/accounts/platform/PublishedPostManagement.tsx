import { useState } from "react";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { useT } from "../../../../../shared/i18n";
import { truncateGraphemes } from "../../../../../shared/lib/text/truncate";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import type {
  PublishedPostDeletion,
  PublishedPost,
  PublishedPosts,
} from "../../../model/publishedPosts";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

export function PublishedPostManagement({
  platform,
  accountId,
  accountName,
  client,
}: {
  platform: "reddit" | "telegram";
  accountId: string;
  accountName: string;
  client: SocialClient;
}) {
  const t = useT();
  const confirmation = useConfirm();
  const work = useAccountWrite(t("Could not save changes."));
  const [page, setPage] = useState<PublishedPosts>();
  const [picked, setPicked] = useState("");
  const post = page?.posts.find((item) => item.jobId === picked);
  const reviewUrl = post?.deletion === "review" ? post.url : undefined;
  const busy = work.is("posts") || work.is("delete");
  const label = (item: PublishedPost) => {
    const target = item.subreddit;
    const title = truncateGraphemes(item.title, 80) || item.postId;
    if (!target) return title;
    const destination = /^u_/i.test(target) ? `u/${target.slice(2)}` : `r/${target}`;
    return `${destination} · ${title}`;
  };

  const load = async (offset?: number) => {
    const next = await work.write("posts", () =>
      client.request<PublishedPosts>(`${platform}.posts.published`, {
        accountId,
        ...(offset !== undefined ? { offset } : {}),
      }),
    );
    if (next)
      setPage((current) =>
        offset !== undefined && current
          ? {
              ...next,
              posts: [
                ...new Map(
                  [...current.posts, ...next.posts].map((item) => [item.jobId, item]),
                ).values(),
              ],
            }
          : next,
      );
  };
  const remove = async () => {
    if (!post || post.deletion || busy) return;
    if (
      !(await confirmation.confirm({
        title: t("Delete post"),
        context: accountName,
        message: label(post),
        details: post.postId,
        confirmLabel: t("Delete"),
        danger: true,
      }))
    )
      return;
    const result = await work.write("delete", () =>
      client.request<{ status: PublishedPostDeletion }>(`${platform}.post.delete`, {
        accountId,
        jobId: post.jobId,
        postId: post.postId,
        confirm: `DELETE_${platform.toUpperCase()}_POST`,
      }),
    );
    if (result)
      setPage(
        (current) =>
          current && {
            ...current,
            posts: current.posts.map((item) =>
              item.postId === post.postId ? { ...item, deletion: result.status } : item,
            ),
          },
      );
  };
  return (
    <div className="social-stack">
      <Button
        size="sm"
        disabled={busy}
        loading={work.is("posts")}
        onClick={() => void load().catch(() => undefined)}
      >
        {page ? t("Refresh") : t("Load my posts")}
      </Button>
      {page?.posts.length ? (
        <>
          <Select
            label={t("Post")}
            value={post?.jobId ?? ""}
            disabled={busy}
            options={[
              { value: "", label: t("Choose a post") },
              ...page.posts.map((item) => ({
                value: item.jobId,
                label: label(item),
              })),
            ]}
            onValueChange={setPicked}
          />
          <Button
            size="sm"
            tone="danger"
            disabled={!post || !!post.deletion || busy}
            loading={work.is("delete")}
            onClick={() => void remove().catch(() => undefined)}
          >
            {t("Delete post")}
          </Button>
        </>
      ) : page ? (
        <EmptyState size="inline" description={t("No posts yet.")} />
      ) : null}
      {page?.next !== undefined ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void load(page.next).catch(() => undefined)}
        >
          {t("Load more")}
        </Button>
      ) : null}
      {post?.deletion === "deleted" ? (
        <InlineMessage tone="success">{t("Deleted")}</InlineMessage>
      ) : null}
      {post?.deletion === "review" ? (
        <>
          <InlineMessage tone="warning">{t("Needs review")}</InlineMessage>
          {reviewUrl ? (
            <Button
              variant="link"
              onClick={() => {
                void work.write("open", () => openExternal(reviewUrl)).catch(() => undefined);
              }}
            >
              {t("Open post")}
            </Button>
          ) : null}
        </>
      ) : null}
      {work.error ? <InlineError details={work.details}>{work.error}</InlineError> : null}
      {confirmation.dialog}
    </div>
  );
}
