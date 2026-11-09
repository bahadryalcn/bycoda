import type { SocialAdapter, SocialHttp, SocialInbound } from "../adapter";
import { SocialPlatformError } from "../adapter";
import type { CollectedPerson } from "../audience-types";
import {
  linkedInCommentaryIssue,
  publishLinkedInDocument,
  publishLinkedInMultiImage,
  validateImage,
} from "../linkedinMedia";
import { at, completeScanPost, enqueueKnownPosts, id, requireId, scanState, text } from "./common";

const ownPostUrn = (value: unknown): value is string =>
  typeof value === "string" && /^urn:li:(?:share|ugcPost):[1-9]\d{0,24}$/.test(value);

export function createLinkedInAdapter(http: SocialHttp, linkedinVersion: string): SocialAdapter {
  return {
    ownedPostPages: true,
    async send(account, job, token, media, checkpoint, beforeSubmit) {
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
        await beforeSubmit?.();
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
      // Limits are checked before any upload or registration request.
      if (linkedInCommentaryIssue(job)) throw new SocialPlatformError("unsupported");
      if (job.payload.media.some((item) => item.kind === "document")) {
        if (job.payload.media.length !== 1) throw new SocialPlatformError("unsupported");
        return publishLinkedInDocument(
          http,
          account,
          job,
          token,
          linkedinVersion,
          media,
          checkpoint,
          beforeSubmit,
        );
      }
      if (job.payload.media.length > 1)
        return publishLinkedInMultiImage(
          http,
          account,
          job,
          token,
          linkedinVersion,
          media,
          checkpoint,
          beforeSubmit,
        );
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
          const bytes = await media(item.uploadId);
          validateImage(bytes);
          const { value: registration } = await http.json(
            "https://api.linkedin.com/rest/images?action=initializeUpload",
            token,
            { initializeUploadRequest: { owner: author } },
            headers,
          );
          image = requireId(registration.value?.image);
          await http.uploadLinkedInImage(requireId(registration.value?.uploadUrl), token, bytes);
          await checkpoint?.({ mediaIds: [image] });
        }
        const { value: readiness } = await http.request(
          `https://api.linkedin.com/rest/images/${id(image)}`,
          token,
          { headers },
        );
        if (readiness.owner !== author) throw new SocialPlatformError("denied");
        // Same processing outcome as the multi-image path; a rate limit would misreport it.
        if (["WAITING_UPLOAD", "PROCESSING"].includes(readiness.status))
          throw new SocialPlatformError("processing", Date.now() + 60_000);
        if (readiness.status !== "AVAILABLE") throw new SocialPlatformError("rejected");
      }
      await beforeSubmit?.();
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
    async poll(account, token, posts, cursor, ownedPosts) {
      const events: SocialInbound[] = [];
      const scan = scanState(cursor);
      const headers = {
        "LinkedIn-Version": linkedinVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      };
      const canDiscover =
        account.accountType === "organization" && account.scopes.includes("r_organization_social");
      const needsBatch = !scan.posts.length;
      if (needsBatch) await enqueueKnownPosts(scan, posts, ownedPosts);
      if (canDiscover && needsBatch) {
        const { value } = await http.request(
          `https://api.linkedin.com/rest/posts?q=author&author=${id(account.platformId)}&sortBy=LAST_MODIFIED&count=25&start=${scan.discoveryStart ?? 0}`,
          token,
          { headers },
        );
        if (!Array.isArray(value.elements)) throw new SocialPlatformError("unsupported");
        if (value.elements.length > 25) throw new SocialPlatformError("unknown");
        for (const post of value.elements) {
          const postId = requireId(post.id);
          if (!scan.posts.includes(postId)) scan.posts.push(postId);
        }
        const start = scan.discoveryStart ?? 0;
        scan.discoveryStart =
          value.elements.length === 25 &&
          (!Number.isFinite(value.paging?.total) || start + 25 < value.paging.total)
            ? start + 25
            : 0;
      }
      if (
        !scan.posts.length &&
        !(
          account.accountType === "organization" && account.scopes.includes("r_organization_social")
        )
      )
        throw new SocialPlatformError("unsupported");
      for (
        let read = 0, limit = Math.min(4, scan.posts.length);
        read < limit && scan.posts.length;
        read++
      ) {
        scan.index %= scan.posts.length;
        const post = scan.posts[scan.index];
        const start = scan.starts[post] ?? 0;
        const { value } = await http.request(
          `https://api.linkedin.com/rest/socialActions/${id(post)}/comments?count=100&start=${start}`,
          token,
          { headers },
        );
        if (!Array.isArray(value.elements)) throw new SocialPlatformError("unsupported");
        for (const comment of value.elements)
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
          completeScanPost(scan, post);
        }
      }
      return { events, cursor: JSON.stringify(scan) };
    },
    /**
     * Organization-only audience from the owner's own post. The post must be named explicitly
     * (postRef); this adapter does not discover posts for collection. Reactions endpoint and
     * actor fields are not verified live, and LinkedIn does not return actor names here, so the
     * actor URN is used as the display name.
     */
    async collectAudience(account, token, source, cursor) {
      const postRef = "postRef" in source ? source.postRef : undefined;
      if (
        account.accountType !== "organization" ||
        !account.scopes.includes("r_organization_social") ||
        (source.kind !== "own_post_comments" && source.kind !== "own_post_likes") ||
        !ownPostUrn(postRef)
      )
        throw new SocialPlatformError("unsupported");
      const headers = {
        "LinkedIn-Version": linkedinVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      };
      const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) : 0;
      const isComments = source.kind === "own_post_comments";
      const url = isComments
        ? `https://api.linkedin.com/rest/socialActions/${id(postRef)}/comments?count=100&start=${start}`
        : `https://api.linkedin.com/rest/reactions?q=entity&entity=${encodeURIComponent(postRef)}&count=100&start=${start}`;
      const { value } = await http.request(url, token, { headers });
      if (!Array.isArray(value.elements)) throw new SocialPlatformError("unsupported");
      const people: CollectedPerson[] = value.elements
        .filter((row: { actor?: unknown }) => row.actor !== account.platformId)
        .map(
          (row: {
            actor?: unknown;
            commentUrn?: unknown;
            created?: { time?: unknown };
          }): CollectedPerson => {
            const actor = requireId(row.actor);
            return {
              platformId: actor,
              name: actor,
              kind: isComments ? "comment" : "like",
              ref: isComments ? requireId(row.commentUrn) : postRef,
              at: at(row.created?.time),
            };
          },
        );
      const total = value.paging?.total;
      const next =
        value.elements.length === 100 && (!Number.isFinite(total) || start + 100 < Number(total))
          ? String(start + 100)
          : undefined;
      return { people, next };
    },
  };
}
