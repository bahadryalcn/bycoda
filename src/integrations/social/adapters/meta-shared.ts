import type { SocialAdapter, SocialHttp, SocialInbound, SocialJob } from "../adapter";

import { SocialPlatformError } from "../adapter";
import { createFacebookReelsAdapter } from "../facebookReels";
import { publishMetaMedia } from "../metaMedia";
import {
  at,
  completeScanPost,
  enqueueKnownPosts,
  graphNext,
  id,
  requireId,
  scanState,
  text,
} from "./common";
import { metaExtendedOperations } from "./meta-extended";

/**
 * Meta's standard 24-hour messaging window. The host records `replyUntil` on the thread; when it is
 * present on the job, a send after the window is refused before any request.
 * shortcut: the job payload carries replyUntil only when the host sets it; the host also checks at execution.
 */
function assertReplyWindow(job: SocialJob): void {
  const replyUntil = (job.payload as SocialJob["payload"] & { replyUntil?: number }).replyUntil;
  if (replyUntil !== undefined && Date.now() > replyUntil)
    throw new SocialPlatformError("rejected", undefined, { reasonCode: "meta.window_closed" });
}

/** Instagram and Facebook share Graph publishing, comment and conversation polling code. */
export function createMetaAdapter(
  http: SocialHttp,
  graphVersion: string,
  platform: "instagram" | "facebook",
): SocialAdapter {
  const reels = createFacebookReelsAdapter(http, graphVersion);
  const origin =
    platform === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
  const endpoint = (path: string) => `${origin}/${graphVersion}/${path}`;
  return {
    ownedPostPages: true,
    async send(account, job, token, media, checkpoint, beforeSubmit) {
      if (platform !== "facebook" && job.payload.facebook)
        throw new SocialPlatformError("unsupported");
      if (platform === "facebook" && job.payload.facebook)
        return reels.send(account, job, token, media, checkpoint, beforeSubmit);
      if (
        job.kind === "message" ||
        (job.kind === "reply" && job.payload.recipientId && !job.payload.postId)
      ) {
        assertReplyWindow(job);
        await beforeSubmit?.();
        const { value } = await http.json(endpoint(`${id(account.platformId)}/messages`), token, {
          recipient: { id: job.payload.recipientId },
          message: { text: text(job) },
          ...(platform === "facebook" ? { messaging_type: "RESPONSE" } : {}),
        });
        return { platformId: requireId(value.message_id) };
      }
      if (job.kind === "reply" || job.kind === "comment") {
        // Instagram replies attach to a comment ID; top-level comments on arbitrary media are not exposed.
        if (platform === "instagram" && job.kind === "comment")
          throw new SocialPlatformError("unsupported");
        const path = `${id(job.payload.postId)}/${platform === "instagram" ? "replies" : "comments"}`;
        await beforeSubmit?.();
        const { value } = await http.json(endpoint(path), token, { message: text(job) });
        return { platformId: requireId(value.id) };
      }
      // Every publication (single image, carousel, video, text) uses the durable preparation path,
      // which checks platform limits before the first request.
      return publishMetaMedia(
        http,
        platform,
        account,
        job,
        token,
        graphVersion,
        checkpoint,
        beforeSubmit,
      );
    },
    async reconcile(account, job, token) {
      return platform === "facebook" && job.payload.facebook
        ? reels.reconcile!(account, job, token)
        : undefined;
    },
    async poll(account, token, posts, cursor, ownedPosts) {
      const events: SocialInbound[] = [];
      const scan = scanState(cursor);
      const commentScope =
        platform === "instagram" ? "instagram_business_manage_comments" : "pages_read_user_content";
      const canReadComments =
        account.scopes.includes(commentScope) &&
        (platform === "instagram" || account.scopes.includes("pages_read_engagement"));
      if (canReadComments && !scan.posts.length) {
        await enqueueKnownPosts(scan, posts, ownedPosts);
        const { value: recent } = await http.request(
          endpoint(
            `${id(account.platformId)}/${platform === "instagram" ? "media" : "published_posts"}?fields=id&limit=25${scan.discovery ? `&after=${encodeURIComponent(scan.discovery)}` : ""}`,
          ),
          token,
        );
        if (!Array.isArray(recent.data) || recent.data.length > 25)
          throw new SocialPlatformError("unknown");
        for (const post of recent.data) {
          const postId = requireId(post.id);
          if (!scan.posts.includes(postId)) scan.posts.push(postId);
        }
        scan.discovery = graphNext(recent);
      }
      if (canReadComments)
        for (
          let read = 0, limit = Math.min(4, scan.posts.length);
          read < limit && scan.posts.length;
          read++
        ) {
          scan.index %= scan.posts.length;
          const post = scan.posts[scan.index];
          const fields =
            platform === "instagram" ? "id,text,timestamp,from" : "id,message,created_time,from";
          const { value } = await http.request(
            endpoint(
              `${id(post)}/comments?fields=${fields}&limit=100${scan.after[post] ? `&after=${encodeURIComponent(scan.after[post])}` : ""}`,
            ),
            token,
          );
          for (const comment of value.data ?? [])
            if (comment.from?.id && comment.from.id !== account.platformId)
              events.push({
                eventId: requireId(comment.id),
                threadId: comment.id,
                postId: post,
                contactId: comment.from.id,
                contactName: comment.from.name ?? comment.from.username ?? comment.from.id,
                kind: "comment",
                text: String(comment.text ?? comment.message ?? ""),
                at: at(comment.timestamp ?? comment.created_time),
              });
          const next = graphNext(value);
          if (next) scan.after[post] = next;
          else {
            completeScanPost(scan, post);
          }
        }
      const messageScope =
        platform === "instagram" ? "instagram_business_manage_messages" : "pages_messaging";
      if (account.scopes.includes(messageScope)) {
        const { value } = await http.request(
          endpoint(
            `${id(account.platformId)}/conversations?${platform === "instagram" ? "platform=instagram&" : ""}fields=id,messages.limit(100){id,message,from,created_time}&limit=10${scan.conversations ? `&after=${encodeURIComponent(scan.conversations)}` : ""}`,
          ),
          token,
        );
        scan.conversations = graphNext(value);
        for (const conversation of value.data ?? []) {
          const key = `messages:${requireId(conversation.id)}`;
          const messages = conversation.messages?.data ?? [];
          let next = graphNext(conversation.messages ?? {});
          if (scan.after[key]) {
            const { value: older } = await http.request(
              endpoint(
                `${id(conversation.id)}/messages?fields=id,message,from,created_time&limit=100&after=${encodeURIComponent(scan.after[key])}`,
              ),
              token,
            );
            messages.push(...(older.data ?? []));
            next = graphNext(older);
          }
          if (next) scan.after[key] = next;
          else delete scan.after[key];
          for (const message of messages)
            if (message.from?.id && message.from.id !== account.platformId) {
              const time = at(message.created_time);
              events.push({
                eventId: requireId(message.id),
                threadId: `participant:${requireId(message.from.id)}`,
                contactId: message.from.id,
                contactName: message.from.name ?? message.from.id,
                kind: "message",
                text: String(message.message ?? ""),
                at: time,
                replyUntil: time + 24 * 60 * 60_000,
              });
            }
        }
      }
      return { events, cursor: JSON.stringify(scan) };
    },
    ...metaExtendedOperations(http, graphVersion, platform),
  };
}
