import type { SocialAdapter, SocialHttp } from "../adapter";
import { SocialPlatformError } from "../adapter";
import type { CollectedPerson } from "../audience-types";
import { at, graphNext, id, requireId } from "./common";

type Platform = "instagram" | "facebook";
export type MetaExtendedOperations = Pick<
  SocialAdapter,
  "deletePost" | "listPosts" | "getAnalytics" | "collectAudience"
>;
export type CommentAction = "hide" | "unhide" | "delete";

const after = (cursor?: string) => (cursor ? `&after=${encodeURIComponent(cursor)}` : "");
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** One insight metric from a Graph insights response; unknown metric names give undefined. */
function metric(value: Record<string, any>, name: string): number | undefined {
  const row = (value.data ?? []).find((item: { name?: string }) => item.name === name);
  const number = Number(row?.values?.[0]?.value ?? row?.total_value?.value);
  return Number.isFinite(number) ? number : undefined;
}

function origin(platform: Platform): string {
  return platform === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
}

/**
 * Meta operations beyond publishing and polling. Metric and edge names are unverified against a
 * live Graph version; a metric Meta rejects fails the read rather than being reported as zero.
 */
export function metaExtendedOperations(
  http: SocialHttp,
  graphVersion: string,
  platform: Platform,
): MetaExtendedOperations {
  const endpoint = (path: string) => `${origin(platform)}/${graphVersion}/${path}`;
  const deletePost: NonNullable<SocialAdapter["deletePost"]> = async (
    _account,
    token,
    platformId,
  ) => {
    const { value } = await http.request(endpoint(id(platformId)), token, { method: "DELETE" });
    if (value.success !== true) throw new SocialPlatformError("unknown");
  };
  return {
    ...(platform === "facebook" ? { deletePost } : {}),
    async listPosts(account, token, cursor) {
      const instagram = platform === "instagram";
      const fields = instagram
        ? "id,permalink,timestamp,caption"
        : "id,permalink_url,created_time,message";
      const edge = instagram ? "media" : "published_posts";
      const { value } = await http.request(
        endpoint(`${id(account.platformId)}/${edge}?fields=${fields}&limit=25${after(cursor)}`),
        token,
      );
      const rows: Record<string, any>[] = Array.isArray(value.data) ? value.data : [];
      return {
        posts: rows.map((row) => ({
          id: requireId(row.id),
          url: str(row.permalink ?? row.permalink_url),
          at: at(row.timestamp ?? row.created_time),
          text: str(row.caption ?? row.message),
        })),
        next: graphNext(value),
      };
    },
    async getAnalytics(_account, token, postIds) {
      if (postIds.length > 25) throw new SocialPlatformError("rejected");
      const result: Record<
        string,
        { views?: number; likes?: number; comments?: number; shares?: number }
      > = {};
      for (const postId of postIds) {
        const post = id(postId);
        if (platform === "facebook") {
          const { value } = await http.request(
            endpoint(
              `${post}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares`,
            ),
            token,
          );
          const { value: insights } = await http.request(
            endpoint(`${post}/insights?metric=post_impressions_unique`),
            token,
          );
          result[postId] = {
            views: metric(insights, "post_impressions_unique"),
            likes: Number(value.likes?.summary?.total_count) || undefined,
            comments: Number(value.comments?.summary?.total_count) || undefined,
            shares: Number(value.shares?.count) || undefined,
          };
        } else {
          const { value } = await http.request(
            endpoint(`${post}/insights?metric=views,likes,comments,shares`),
            token,
          );
          result[postId] = {
            views: metric(value, "views"),
            likes: metric(value, "likes"),
            comments: metric(value, "comments"),
            shares: metric(value, "shares"),
          };
        }
      }
      return result;
    },
    async collectAudience(account, token, source, cursor) {
      const actor = id(account.platformId);
      if (source.kind === "own_post_comments" || source.kind === "own_post_likes") {
        if (!source.postRef) throw new SocialPlatformError("unsupported");
        const post = id(source.postRef);
        if (source.kind === "own_post_likes") {
          // shortcut: Instagram does not expose who liked a post through Graph; reactions are Facebook-only.
          if (platform !== "facebook") throw new SocialPlatformError("unsupported");
          const { value } = await http.request(
            endpoint(`${post}/reactions?fields=id,name&limit=100${after(cursor)}`),
            token,
          );
          const seen = Date.now();
          const people: CollectedPerson[] = (value.data ?? []).map(
            (row: { id?: unknown; name?: unknown }) => ({
              platformId: requireId(row.id),
              name: String(row.name ?? row.id),
              kind: "like",
              ref: source.postRef,
              // Reaction edges carry no timestamp; the read time is recorded instead.
              at: seen,
            }),
          );
          return { people, next: graphNext(value) };
        }
        const fields =
          platform === "instagram" ? "id,text,timestamp,from" : "id,message,created_time,from";
        const { value } = await http.request(
          endpoint(`${post}/comments?fields=${fields}&limit=100${after(cursor)}`),
          token,
        );
        const people: CollectedPerson[] = [];
        for (const comment of value.data ?? []) {
          if (!comment.from?.id || comment.from.id === account.platformId) continue;
          people.push({
            platformId: requireId(comment.from.id),
            name: String(comment.from.name ?? comment.from.username ?? comment.from.id),
            kind: "comment",
            text: String(comment.text ?? comment.message ?? ""),
            ref: requireId(comment.id),
            at: at(comment.timestamp ?? comment.created_time),
          });
        }
        return { people, next: graphNext(value) };
      }
      if (source.kind === "dm_senders") {
        const { value } = await http.request(
          endpoint(
            `${actor}/conversations?${platform === "instagram" ? "platform=instagram&" : ""}fields=id,messages.limit(100){id,message,from,created_time}&limit=10${after(cursor)}`,
          ),
          token,
        );
        const people: CollectedPerson[] = [];
        for (const conversation of value.data ?? []) {
          for (const message of conversation.messages?.data ?? []) {
            if (!message.from?.id || message.from.id === account.platformId) continue;
            people.push({
              platformId: requireId(message.from.id),
              name: String(message.from.name ?? message.from.id),
              kind: "dm",
              ref: requireId(conversation.id),
              at: at(message.created_time),
            });
          }
        }
        return { people, next: graphNext(value) };
      }
      // shortcut: hashtag media does not expose author identities under Instagram Login; mentions and followers are not read. Upgrade when a verified author field exists.
      throw new SocialPlatformError("unsupported");
    },
  };
}

/** Hide, unhide or delete one comment on a managed post. Not part of SocialAdapter; the host calls it directly. */
export async function metaCommentAction(
  http: SocialHttp,
  graphVersion: string,
  platform: Platform,
  token: string,
  commentId: string,
  action: CommentAction,
): Promise<void> {
  const comment = id(commentId);
  const url = (path: string) => `${origin(platform)}/${graphVersion}/${path}`;
  if (action === "delete") {
    const { value } = await http.request(url(comment), token, { method: "DELETE" });
    if (value.success !== true) throw new SocialPlatformError("unknown");
    return;
  }
  if (platform === "facebook") {
    await http.json(url(comment), token, { is_hidden: action === "hide" });
    return;
  }
  await http.request(url(`${comment}?hide=${action === "hide"}`), token, { method: "POST" });
}
