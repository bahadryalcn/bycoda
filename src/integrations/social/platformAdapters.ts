import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { createYouTubeAdapter } from "./youtube";
import { uploadXMedia, xMediaIssue } from "./xMedia";
import { createTikTokAdapter, tiktokContentIssue } from "./tiktok";
import { createTelegramAdapter, createWhatsAppAdapter, profileOnlyAdapter } from "./messaging";
import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialAdapters,
  type SocialInbound,
} from "./adapter";

const id = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:.(),-]{1,300}$/.test(value))
    throw new SocialPlatformError("rejected");
  return encodeURIComponent(value);
};
const text = (job: SocialJob) => [job.payload.text, job.payload.link].filter(Boolean).join("\n");
type Scan = {
  posts: string[];
  index: number;
  after: Record<string, string>;
  conversations?: string;
  discovery?: string;
  starts: Record<string, number>;
};
function scanState(cursor?: string): Scan {
  try {
    const saved = JSON.parse(cursor ?? "{}");
    if (Array.isArray(saved.posts) && saved.after && saved.starts && Number.isInteger(saved.index))
      return saved;
  } catch {
    /* Old/no cursor starts a bounded scan. */
  }
  return { posts: [], index: 0, after: {}, starts: {} };
}
const graphNext = (value: Record<string, any>): string | undefined =>
  value.paging?.next && typeof value.paging?.cursors?.after === "string"
    ? value.paging.cursors.after
    : undefined;
function requireId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new SocialPlatformError("unknown");
  return value;
}
const at = (value: unknown) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  if (!Number.isFinite(parsed)) throw new SocialPlatformError("rejected");
  return parsed;
};

export function createSocialAdapters(
  http = new SocialHttp(),
  graphVersion = "v25.0",
  linkedinVersion = "202609",
): SocialAdapters {
  if (!/^v\d+\.0$/.test(graphVersion) || !/^20\d{4}$/.test(linkedinVersion))
    throw new Error("Invalid social API version.");
  const x: SocialAdapter = {
    async send(_account, job, token, media, checkpoint) {
      const message =
        job.kind === "message" ||
        (job.kind === "reply" && !!job.payload.recipientId && !job.payload.postId);
      const mediaIds = await uploadXMedia(http, job, token, media, message, checkpoint);
      if (
        job.kind === "message" ||
        (job.kind === "reply" && job.payload.recipientId && !job.payload.postId)
      ) {
        const path = job.payload.threadId
          ? `dm_conversations/${id(job.payload.threadId)}/messages`
          : `dm_conversations/with/${id(job.payload.recipientId)}/messages`;
        const { value } = await http.json(`https://api.x.com/2/${path}`, token, {
          text: text(job),
          ...(mediaIds.length ? { attachments: [{ media_id: mediaIds[0] }] } : {}),
        });
        return { platformId: requireId(value.data?.dm_event_id) };
      }
      const { value } = await http.json("https://api.x.com/2/tweets", token, {
        text: text(job),
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
        ...(job.payload.postId ? { reply: { in_reply_to_tweet_id: job.payload.postId } } : {}),
      });
      const platformId = requireId(value.data?.id);
      return { platformId, url: `https://x.com/i/status/${id(platformId)}` };
    },
    async poll(account, token, _posts, cursor) {
      const events: SocialInbound[] = [];
      type Page = { since?: string; next?: string; newest?: string };
      let state: { mentions: Page; dm: Page } = { mentions: {}, dm: {} };
      if (cursor) {
        try {
          const saved = JSON.parse(cursor);
          if (saved.mentions && saved.dm) state = saved;
          else if (/^\d+$/.test(cursor)) state.mentions.since = cursor;
        } catch {
          state.mentions.since = cursor;
        }
      }
      if (account.scopes.includes("tweet.read")) {
        const page = state.mentions;
        const query = new URLSearchParams({
          "post.fields": "created_at,author_id,conversation_id",
          max_results: "100",
        });
        if (page.since) query.set("since_id", page.since);
        if (page.next) query.set("pagination_token", page.next);
        const { value } = await http.request(
          `https://api.x.com/2/users/${id(account.platformId)}/mentions?${query}`,
          token,
        );
        for (const post of value.data ?? [])
          events.push({
            eventId: requireId(post.id),
            threadId: requireId(post.id),
            postId: post.id,
            contactId: requireId(post.author_id),
            contactName: post.author_id,
            text: String(post.text ?? ""),
            at: at(post.created_at),
            kind: "comment",
          });
        page.newest ??= value.meta?.newest_id;
        page.next = value.meta?.next_token;
        // Commit the high-water mark only after all older pages are ingested.
        if (!page.next) {
          page.since = page.newest ?? page.since;
          delete page.newest;
        }
      }
      if (account.scopes.includes("dm.read")) {
        const page = state.dm;
        const query = new URLSearchParams({
          "dm_event.fields": "created_at,event_type,text,dm_conversation_id",
          expansions: "sender_id",
          event_types: "MessageCreate",
          max_results: "100",
        });
        if (page.next) query.set("pagination_token", page.next);
        const { value } = await http.request(`https://api.x.com/2/dm_events?${query}`, token);
        page.newest ??= value.data?.[0]?.id;
        const reached = (value.data ?? []).some((dm: { id: string }) => dm.id === page.since);
        for (const dm of value.data ?? [])
          if (dm.sender_id !== account.platformId && dm.event_type === "MessageCreate")
            events.push({
              eventId: requireId(dm.id),
              threadId: requireId(dm.dm_conversation_id),
              contactId: requireId(dm.sender_id),
              contactName: dm.sender_id,
              text: String(dm.text ?? ""),
              at: at(dm.created_at),
              kind: "message",
            });
        page.next = reached ? undefined : value.meta?.next_token;
        if (!page.next) {
          page.since = page.newest ?? page.since;
          delete page.newest;
        }
      }
      return { events, cursor: JSON.stringify(state) };
    },
  };
  const meta = (platform: "instagram" | "facebook"): SocialAdapter => {
    const origin =
      platform === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
    const endpoint = (path: string) => `${origin}/${graphVersion}/${path}`;
    return {
      async send(account, job, token, _media, checkpoint) {
        if (
          job.kind === "message" ||
          (job.kind === "reply" && job.payload.recipientId && !job.payload.postId)
        ) {
          const { value } = await http.json(endpoint(`${id(account.platformId)}/messages`), token, {
            recipient: { id: job.payload.recipientId },
            message: { text: text(job) },
            ...(platform === "facebook" ? { messaging_type: "RESPONSE" } : {}),
          });
          return { platformId: requireId(value.message_id) };
        }
        if (job.kind === "reply" || job.kind === "comment") {
          const path = `${id(job.payload.postId)}/${platform === "instagram" ? "replies" : "comments"}`;
          const { value } = await http.json(
            endpoint(path),
            token,
            platform === "instagram" ? { message: text(job) } : { message: text(job) },
          );
          return { platformId: requireId(value.id) };
        }
        if (platform === "facebook") {
          const item = job.payload.media[0];
          if (job.payload.media.length > 1 || item?.kind === "video" || (item && !item.url))
            throw new SocialPlatformError("unsupported");
          const { value } = await http.json(
            endpoint(`${id(account.platformId)}/${item ? "photos" : "feed"}`),
            token,
            item
              ? { url: item.url, caption: text(job), published: true }
              : {
                  message: job.payload.text,
                  ...(job.payload.link ? { link: job.payload.link } : {}),
                },
          );
          const platformId = requireId(value.post_id ?? value.id);
          return {
            platformId,
            url: `https://www.facebook.com/${id(platformId)}`,
          };
        }
        const item = job.payload.media[0];
        if (!item?.url || item.kind !== "image" || job.payload.media.length !== 1)
          throw new SocialPlatformError("unsupported");
        let containerId = job.preparation?.containerId;
        if (!containerId) {
          const { value: container } = await http.json(
            endpoint(`${id(account.platformId)}/media`),
            token,
            {
              image_url: item.url,
              caption: text(job),
              ...(item.alt ? { alt_text: item.alt } : {}),
            },
          );
          containerId = requireId(container.id);
          checkpoint?.({ containerId });
        }
        const { value: status } = await http.request(
          endpoint(`${id(containerId)}?fields=status_code`),
          token,
        );
        if (status.status_code === "IN_PROGRESS")
          throw new SocialPlatformError("rate_limit", Date.now() + 60_000);
        if (status.status_code !== "FINISHED") throw new SocialPlatformError("rejected");
        const { value } = await http.json(
          endpoint(`${id(account.platformId)}/media_publish`),
          token,
          { creation_id: containerId },
        );
        const platformId = requireId(value.id);
        // Publication succeeded even if the optional permalink read later fails.
        const details = await http
          .request(endpoint(`${id(platformId)}?fields=permalink`), token)
          .catch(() => undefined);
        return { platformId, url: details?.value.permalink };
      },
      async poll(account, token, posts, cursor) {
        const events: SocialInbound[] = [];
        const scan = scanState(cursor);
        const owned = [...scan.posts, ...posts];
        const commentScope =
          platform === "instagram"
            ? "instagram_business_manage_comments"
            : "pages_read_user_content";
        const canReadComments =
          account.scopes.includes(commentScope) &&
          (platform === "instagram" || account.scopes.includes("pages_read_engagement"));
        if (canReadComments) {
          const { value: recent } = await http.request(
            endpoint(
              `${id(account.platformId)}/${platform === "instagram" ? "media" : "published_posts"}?fields=id&limit=25${scan.discovery ? `&after=${encodeURIComponent(scan.discovery)}` : ""}`,
            ),
            token,
          );
          owned.push(...(recent.data ?? []).map((post: { id: string }) => requireId(post.id)));
          scan.discovery = graphNext(recent);
        }
        scan.posts = [...new Set(owned)];
        if (canReadComments)
          for (let read = 0; read < Math.min(4, scan.posts.length); read++) {
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
              delete scan.after[post];
              scan.index = (scan.index + 1) % scan.posts.length;
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
    };
  };
  const linkedin: SocialAdapter = {
    async send(account, job, token, media, checkpoint) {
      const headers = {
        "LinkedIn-Version": linkedinVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      };
      const author = account.platformId.startsWith("urn:")
        ? account.platformId
        : `urn:li:${account.accountType === "organization" ? "organization" : "person"}:${account.platformId}`;
      if (job.kind === "message") throw new SocialPlatformError("unsupported");
      if (job.kind !== "publish") {
        const nested = job.kind === "reply";
        if (
          nested &&
          (!job.payload.postId?.startsWith("urn:li:comment:") || !job.payload.objectPostId)
        )
          throw new SocialPlatformError("unsupported");
        const { value, headers: responseHeaders } = await http.json(
          `https://api.linkedin.com/rest/socialActions/${id(job.payload.postId)}/comments`,
          token,
          {
            actor: author,
            message: { text: text(job) },
            object: job.payload.objectPostId ?? job.payload.postId,
            ...(nested ? { parentComment: job.payload.postId } : {}),
          },
          headers,
        );
        return {
          platformId: requireId(responseHeaders.get("x-restli-id") ?? value.id),
        };
      }
      let image: string | undefined;
      if (job.payload.media.length) {
        const item = job.payload.media[0];
        if (
          account.accountType !== "organization" ||
          job.payload.media.length !== 1 ||
          item.kind !== "image" ||
          !item.uploadId
        )
          throw new SocialPlatformError("unsupported");
        image = job.preparation?.mediaIds?.[0];
        if (!image) {
          const { value: registration } = await http.json(
            "https://api.linkedin.com/rest/images?action=initializeUpload",
            token,
            { initializeUploadRequest: { owner: author } },
            headers,
          );
          image = requireId(registration.value?.image);
          await http.uploadLinkedInImage(
            requireId(registration.value?.uploadUrl),
            token,
            await media(item.uploadId),
          );
          checkpoint?.({ mediaIds: [image] });
        }
        const { value: readiness } = await http.request(
          `https://api.linkedin.com/rest/images/${id(image)}`,
          token,
          { headers },
        );
        if (["WAITING_UPLOAD", "PROCESSING"].includes(readiness.status))
          throw new SocialPlatformError("rate_limit", Date.now() + 60_000);
        if (readiness.status !== "AVAILABLE") throw new SocialPlatformError("rejected");
      }
      const { headers: responseHeaders, value } = await http.json(
        "https://api.linkedin.com/rest/posts",
        token,
        {
          author,
          commentary: text(job),
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
          ...(image
            ? {
                content: {
                  media: {
                    id: image,
                    ...(job.payload.media[0]?.alt ? { altText: job.payload.media[0].alt } : {}),
                  },
                },
              }
            : {}),
        },
        headers,
      );
      const platformId = requireId(responseHeaders.get("x-restli-id") ?? value.id);
      return {
        platformId,
        url: `https://www.linkedin.com/feed/update/${encodeURIComponent(platformId)}/`,
      };
    },
    async poll(account, token, posts, cursor) {
      const events: SocialInbound[] = [];
      const scan = scanState(cursor);
      const headers = {
        "LinkedIn-Version": linkedinVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      };
      const owned = [...scan.posts, ...posts];
      if (
        account.accountType === "organization" &&
        account.scopes.includes("r_organization_social")
      ) {
        const { value } = await http.request(
          `https://api.linkedin.com/rest/posts?q=author&author=${id(account.platformId)}&sortBy=LAST_MODIFIED&count=25`,
          token,
          { headers },
        );
        owned.push(...(value.elements ?? []).map((post: { id: string }) => requireId(post.id)));
      }
      scan.posts = [...new Set(owned)];
      for (let read = 0; read < Math.min(4, scan.posts.length); read++) {
        scan.index %= scan.posts.length;
        const post = scan.posts[scan.index];
        const start = scan.starts[post] ?? 0;
        const { value } = await http.request(
          `https://api.linkedin.com/rest/socialActions/${id(post)}/comments?count=100&start=${start}`,
          token,
          { headers },
        );
        for (const comment of value.elements ?? [])
          if (comment.actor !== account.platformId)
            events.push({
              eventId: requireId(comment.commentUrn),
              threadId: requireId(comment.commentUrn),
              postId: comment.object ?? post,
              contactId: requireId(comment.actor),
              contactName: comment.actor,
              text: String(comment.message?.text ?? ""),
              kind: "comment",
              at: at(comment.created?.time),
            });
        if (
          (value.elements?.length ?? 0) === 100 &&
          (!Number.isFinite(value.paging?.total) || start + 100 < value.paging.total)
        )
          scan.starts[post] = start + 100;
        else {
          delete scan.starts[post];
          scan.index = (scan.index + 1) % scan.posts.length;
        }
      }
      return { events, cursor: JSON.stringify(scan) };
    },
  };
  return {
    x,
    instagram: meta("instagram"),
    facebook: meta("facebook"),
    linkedin,
    youtube: createYouTubeAdapter(http),
    tiktok: createTikTokAdapter(http),
    snapchat: profileOnlyAdapter,
    whatsapp: createWhatsAppAdapter(http, graphVersion),
    telegram: createTelegramAdapter(http),
  };
}

export function contentSupport(
  account: SocialAccount,
  job: Pick<SocialJob, "payload" | "kind">,
): string | undefined {
  if (account.platform === "tiktok") return tiktokContentIssue(job);
  if (account.platform === "x") {
    const message =
      job.kind === "message" ||
      (job.kind === "reply" && !!job.payload.recipientId && !job.payload.postId);
    if (message && account.connection === "browser" && job.payload.media.length)
      return "Browser DM media attachments are unavailable; use the X API connection.";
    return xMediaIssue(job.payload.media, message);
  }
  if (job.kind !== "publish" && job.payload.media.length)
    return "Reply/message media attachments are not supported yet.";
  if (account.platform === "youtube" && job.kind === "publish") {
    const options = job.payload.youtube;
    if (
      job.payload.media.length !== 1 ||
      job.payload.media[0].kind !== "video" ||
      !job.payload.media[0].uploadId ||
      job.payload.media[0].url
    )
      return "YouTube requires one host-uploaded MP4/WebM video up to 64 MiB. Text-only Community posts are not supported.";
    if (
      !options?.title?.trim() ||
      options.title.length > 100 ||
      /[<>]/.test(options.title) ||
      !["private", "unlisted", "public"].includes(options.privacy) ||
      typeof options.madeForKids !== "boolean" ||
      typeof options.containsSyntheticMedia !== "boolean"
    )
      return "Set a valid YouTube title, visibility and explicit audience/synthetic-media declarations.";
    if (
      new TextEncoder().encode([job.payload.text, job.payload.link].filter(Boolean).join("\n"))
        .length > 5000
    )
      return "YouTube description including links must fit 5000 UTF-8 bytes.";
    return undefined;
  }
  if (job.payload.media.some((item) => item.kind === "video"))
    return "Video upload/processing is not implemented; use an image or text.";
  if (
    account.platform === "linkedin" &&
    job.payload.media.length &&
    (account.accountType !== "organization" ||
      job.payload.media.length !== 1 ||
      !job.payload.media[0].uploadId)
  )
    return "LinkedIn image publishing requires an organization, one uploaded image and image-readiness permission. Member write-only tokens cannot verify Images API readiness.";
  if (
    account.platform === "instagram" &&
    job.kind === "publish" &&
    (job.payload.media.length !== 1 || !job.payload.media[0].url)
  )
    return "Instagram publishing requires exactly one HTTPS image URL.";
  if (
    account.platform === "facebook" &&
    (job.payload.media.length > 1 || job.payload.media.some((item) => !item.url))
  )
    return "Facebook adapter supports text or one HTTPS image.";
  return undefined;
}
