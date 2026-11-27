import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialErrorCode,
  type SocialSendResult,
} from "./adapter";
import {
  findSnapchatStoryReceipt,
  snapchatApiOrigin as origin,
  snapchatApiProfile,
  snapchatProfileUrl,
  snapchatSnapId as spotlight,
  snapchatUuid as guid,
  verifySnapchatProfile,
  verifySnapchatSavedStorySources,
} from "./snapchat-content";
import { xMediaFormat } from "./xMedia";

const maxAge = 24 * 60 * 60_000;
const partSize = 32 * 1024 * 1024;
type Prepared = NonNullable<NonNullable<SocialJob["preparation"]>["snapchatMedia"]>;
type Media = SocialJob["payload"]["media"][number];

const overlayPosition = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const overlayText = (value: string, limit: number) =>
  value.trim().length > 0 &&
  [...value].length <= limit &&
  /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Mark}\p{Number}\p{Punctuation}\p{Sc} +&=|~<>^]+$/u.test(
    value,
  );

/** Public Profile API IDs are UUIDs; browser usernames/profile markers are not API identities. */
export function snapchatContentIssue(
  account: SocialAccount,
  job: Pick<SocialJob, "payload" | "kind">,
): string | undefined {
  if (!snapchatApiProfile(account))
    return "Snapchat API publishing requires an OAuth-verified Public Profile UUID.";
  const { snapchat: options, media, text, link } = job.payload;
  if (job.kind !== "publish" || !options) return "Choose a Snapchat publishing destination.";
  if (
    media.some(
      (item) =>
        (item.kind !== "image" && item.kind !== "video") ||
        !item.uploadId ||
        item.url ||
        item.alt ||
        item.title,
    )
  )
    return "Snapchat API publishing requires owner-uploaded photos or MP4 videos.";
  if (options.target === "saved_story") {
    const sources = options.savedStorySources ?? [];
    if (!text.trim() || [...text].length > 45 || /[\r\n]/.test(text))
      return "A Snapchat Saved Story needs a title of 1–45 characters.";
    if (
      (!media.length && !sources.length) ||
      sources.some(
        ({ kind, id }) =>
          (kind !== "spotlight" && kind !== "snap") ||
          typeof id !== "string" ||
          !spotlight.test(id),
      )
    )
      return "Choose uploaded media, a Spotlight, or individual Snaps for this Saved Story.";
    if (
      link ||
      options.storyTtl ||
      options.linkStickerText ||
      options.linkStickerPlacement ||
      options.captionCenterY !== undefined
    )
      return "Snapchat Saved Stories use a title and source media, without new link or caption overlays.";
    return;
  }
  if (options.savedStorySources?.length)
    return "Existing Snap or Spotlight sources can only be used in a Saved Story.";
  if (options.target === "spotlight") {
    if (!options.locale || !/^[a-z]{2}_[A-Z]{2}$/.test(options.locale))
      return "Choose an explicit Spotlight language and country locale, such as tr_TR or en_US.";
    if (
      !Number.isFinite(options.durationSeconds) ||
      options.durationSeconds < 6 ||
      options.durationSeconds > 60 ||
      !Number.isFinite(options.width) ||
      options.width < 540 ||
      !Number.isFinite(options.height) ||
      options.height < 960
    )
      return "Snapchat API Spotlight requires a 6–60 second MP4 of at least 540 × 960 pixels.";
    if (media.length !== 1 || media[0].kind !== "video")
      return "Snapchat API Spotlight requires one owner-uploaded MP4 video.";
    if ([...text].length > 160) return "Snapchat Spotlight descriptions must fit 160 characters.";
    if (options.storyTtl || options.captionCenterY !== undefined)
      return "Snapchat Public Story expiry and caption placement apply only to Public Stories.";
  } else if (options.target === "story") {
    if (media.length !== 1)
      return "A Snapchat Public Story submission requires one uploaded photo or MP4 video.";
    if (
      media[0].kind === "video" &&
      (!Number.isFinite(options.durationSeconds) ||
        options.durationSeconds < 5 ||
        options.durationSeconds > 300)
    )
      return "Snapchat Public Story videos must be 5–300 seconds.";
    if (
      options.storyTtl &&
      !["ONE_DAY", "TWO_DAYS", "THREE_DAYS", "ONE_WEEK"].includes(options.storyTtl)
    )
      return "Choose a Snapchat Public Story expiry.";
    if (
      (text && !overlayText(text, 250)) ||
      (options.captionCenterY !== undefined && (!text || !overlayPosition(options.captionCenterY)))
    )
      return "A Snapchat Public Story caption must fit on one line of 1–250 supported characters.";
  } else {
    return "Choose a Snapchat publishing destination.";
  }
  if (link) {
    try {
      const url = new URL(link);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        return "Snapchat links must be full HTTP or HTTPS URLs without credentials.";
    } catch {
      return "Snapchat links must be full HTTP or HTTPS URLs without credentials.";
    }
  }
  if (options.linkStickerText !== undefined && (!link || !overlayText(options.linkStickerText, 40)))
    return "Snapchat link stickers need a link and a single line of up to 40 supported characters.";
  const placement = options.linkStickerPlacement;
  if (
    placement &&
    (!link || !overlayPosition(placement.centerX) || !overlayPosition(placement.centerY))
  )
    return "Snapchat link sticker placement needs a link and coordinates between zero and one.";
}

const requireSuccess = (value: Record<string, any>): void => {
  if (value?.request_status !== "SUCCESS") throw new SocialPlatformError("unknown");
};

function uploadPath(raw: unknown, actorId: string, mediaId: string): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//"))
    throw new SocialPlatformError("denied");
  const url = new URL(raw, origin);
  const path = new RegExp(
    `^/(?:[a-z]{2}/)?v1/public_profiles/${actorId}/media/${mediaId}/multipart-upload$`,
    "i",
  );
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !path.test(url.pathname)
  )
    throw new SocialPlatformError("denied");
  return url.href;
}

async function uploadSnapchatMedia(
  http: SocialHttp,
  actorId: string,
  token: string,
  name: string,
  item: Media,
  read: (id: string) => Promise<Uint8Array>,
): Promise<string> {
  const bytes = await read(item.uploadId!);
  const type = xMediaFormat(bytes) === "mp4" ? "VIDEO" : "IMAGE";
  if ((type === "VIDEO" && item.kind !== "video") || (type === "IMAGE" && item.kind !== "image"))
    throw new SocialPlatformError("unsupported");
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const { encrypted, media } = await (async () => {
    try {
      const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt"]);
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, bytes as BufferSource),
      );
      const { value: media } = await http.json(`${snapchatProfileUrl(actorId)}/media`, token, {
        type,
        name,
        key: btoa(String.fromCharCode(...keyBytes)),
        iv: btoa(String.fromCharCode(...iv)),
      });
      return { encrypted, media };
    } finally {
      keyBytes.fill(0);
      iv.fill(0);
    }
  })();
  requireSuccess(media);
  if (typeof media.media_id !== "string" || !guid.test(media.media_id))
    throw new SocialPlatformError("unknown");
  const mediaId = media.media_id.toLowerCase();
  const add = uploadPath(media.add_path, actorId, mediaId);
  const finalize = uploadPath(media.finalize_path, actorId, mediaId);
  if (add !== finalize) throw new SocialPlatformError("denied");
  for (let offset = 0, part = 1; offset < encrypted.length; offset += partSize, part++) {
    const form = new FormData();
    form.set("action", "ADD");
    form.set("part_number", String(part));
    form.set(
      "file",
      new Blob([encrypted.subarray(offset, offset + partSize)], {
        type: "application/octet-stream",
      }),
      `part-${part}.enc`,
    );
    const { value } = await http.request(add, token, { method: "POST", body: form });
    requireSuccess(value);
  }
  const form = new FormData();
  form.set("action", "FINALIZE");
  const { value } = await http.request(finalize, token, { method: "POST", body: form });
  requireSuccess(value);
  return mediaId;
}

function publishPayload(job: SocialJob, prepared: Prepared) {
  const { text, link } = job.payload;
  const options = job.payload.snapchat!;
  if (options.target === "saved_story") {
    return {
      path: "saved_stories",
      body: {
        saved_stories: [
          {
            title: text,
            snap_sources: [
              ...(options.savedStorySources ?? []).map(({ kind, id }) =>
                kind === "snap" ? { snap_id: id } : { spotlight_id: id },
              ),
              ...(prepared.mediaIds ?? []).map((id) => ({ media_id: id })),
            ],
          },
        ],
      },
    };
  }
  const placement = options.linkStickerPlacement;
  const content = {
    media_id: prepared.mediaId,
    ...(link ? { link } : {}),
    ...(options.linkStickerText ? { link_sticker_text: options.linkStickerText } : {}),
    ...(placement
      ? {
          link_sticker_placement: { center_x: placement.centerX, center_y: placement.centerY },
        }
      : {}),
  };
  if (options.target === "spotlight")
    return {
      path: "spotlights",
      body: { ...content, locale: options.locale, ...(text ? { description: text } : {}) },
    };
  return {
    path: "stories",
    body: {
      ...content,
      ...(options.storyTtl ? { customized_ttl: { ttl: options.storyTtl } } : {}),
      ...(text
        ? {
            captions: [
              {
                text,
                ...(options.captionCenterY !== undefined
                  ? { center_y: options.captionCenterY }
                  : {}),
              },
            ],
          }
        : {}),
    },
  };
}

async function contentSignature(
  account: SocialAccount,
  job: Pick<SocialJob, "kind" | "payload">,
): Promise<string> {
  const value = JSON.stringify([account.platformId.toLowerCase(), job.kind, job.payload]);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Only finalized media IDs and exact posted IDs are durable; encryption material stays ephemeral. */
export function createSnapchatAdapter(http: SocialHttp, now = Date.now): SocialAdapter {
  const identity = (actorId: string, token: string) => verifySnapchatProfile(http, actorId, token);
  async function result(actorId: string, id: string, token: string): Promise<SocialSendResult> {
    if (!spotlight.test(id)) throw new SocialPlatformError("unknown");
    const { value } = await http.request(
      `${snapchatProfileUrl(actorId)}/spotlights/${encodeURIComponent(id)}`,
      token,
    );
    requireSuccess(value);
    if (!Array.isArray(value.spotlights) || value.spotlights.length !== 1)
      throw new SocialPlatformError("unknown");
    const entry = value.spotlights[0],
      post = entry?.spotlight;
    if (
      entry?.sub_request_status !== "SUCCESS" ||
      post?.id !== id ||
      typeof post.profile_id !== "string" ||
      post.profile_id.toLowerCase() !== actorId
    )
      throw new SocialPlatformError("unknown");
    if (post.status === "REJECTED") throw new SocialPlatformError("rejected");
    if (post.status === "SUBMITTED") throw new SocialPlatformError("processing", now() + 60_000);
    if (post.status !== "LIVE") throw new SocialPlatformError("unknown");
    return { platformId: id };
  }
  async function storyResult(
    prepared: Prepared,
    token: string,
    save?: (state: Prepared) => Promise<void>,
  ): Promise<SocialSendResult | undefined> {
    if (!prepared.mediaId || !guid.test(prepared.mediaId)) return;
    const hint =
      prepared.storySnapId && spotlight.test(prepared.storySnapId)
        ? { snapId: prepared.storySnapId, storyId: prepared.storyId }
        : undefined;
    let receipt;
    try {
      await identity(prepared.actorId, token);
      receipt = await findSnapchatStoryReceipt(
        http,
        prepared.actorId,
        token,
        prepared.mediaId,
        hint,
      );
    } catch {
      // A failure during read-back cannot disprove the preceding submission.
      return;
    }
    if (!receipt) return;
    await save?.({ ...prepared, ...receipt });
    return { platformId: receipt.storySnapId };
  }
  return {
    async send(account, job, token, read, checkpoint, beforeSubmit) {
      if (snapchatContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      if (!account.scopes.includes("snapchat-profile-api")) throw new SocialPlatformError("denied");
      const actorId = account.platformId.toLowerCase();
      const signature = await contentSignature(account, job);
      const target = job.payload.snapchat!.target;
      let prepared = job.preparation?.snapchatMedia;
      if (
        prepared &&
        (prepared.actorId !== actorId ||
          prepared.signature !== signature ||
          (target !== "saved_story" && (!prepared.mediaId || !guid.test(prepared.mediaId))) ||
          (target === "saved_story" &&
            (!Array.isArray(prepared.mediaIds) ||
              prepared.mediaIds.length > job.payload.media.length ||
              prepared.mediaIds.some((id) => !guid.test(id)))) ||
          !Number.isFinite(prepared.createdAt) ||
          prepared.createdAt <= 0 ||
          prepared.createdAt > now() + 60_000)
      )
        throw new SocialPlatformError("denied");
      const save = async (state: Prepared) => {
        prepared = state;
        job.preparation = { ...job.preparation, snapchatMedia: { ...state } };
        await checkpoint?.(job.preparation);
      };
      if (prepared?.spotlightId && target === "spotlight")
        return result(actorId, prepared.spotlightId, token);
      if (prepared?.savedStoryId && target === "saved_story" && guid.test(prepared.savedStoryId))
        return { platformId: prepared.savedStoryId };
      if (!checkpoint) throw new SocialPlatformError("unsupported");
      if (prepared?.submittedAt !== undefined) {
        if (target === "story") {
          const returned = await storyResult(prepared, token, save);
          if (returned) return returned;
        }
        throw new SocialPlatformError("unknown");
      }
      if (prepared && job.payload.media.length && prepared.createdAt + maxAge <= now())
        throw new SocialPlatformError("rejected");
      await identity(actorId, token);
      if (target === "saved_story") {
        await verifySnapchatSavedStorySources(
          http,
          actorId,
          token,
          job.payload.snapchat!.savedStorySources ?? [],
        );
        const mediaIds = [...(prepared?.mediaIds ?? [])];
        const createdAt = prepared?.createdAt ?? now();
        for (let i = mediaIds.length; i < job.payload.media.length; i++) {
          const mediaId = await uploadSnapchatMedia(
            http,
            actorId,
            token,
            `bycoda-${job.id}-${i + 1}`,
            job.payload.media[i],
            read,
          );
          mediaIds.push(mediaId);
          await save({ actorId, signature, createdAt, mediaIds: [...mediaIds] });
        }
        prepared ??= { actorId, signature, createdAt, mediaIds };
      } else if (!prepared) {
        const createdAt = now();
        const mediaId = await uploadSnapchatMedia(
          http,
          actorId,
          token,
          `bycoda-${job.id}`,
          job.payload.media[0],
          read,
        );
        await save({ actorId, signature, mediaId, createdAt });
      }
      await identity(actorId, token);
      await beforeSubmit?.();
      // Persist the submission marker before the POST leaves this process.
      const request = publishPayload(job, prepared!);
      await save({ ...prepared!, submittedAt: now() });
      let value: Record<string, any>;
      try {
        ({ value } = await http.json(
          `${snapchatProfileUrl(actorId)}/${request.path}`,
          token,
          request.body,
        ));
      } catch (error) {
        // Rate limits and expired tokens are refused before processing, so a later attempt may post.
        if (
          error instanceof SocialPlatformError &&
          (error.code === "rate_limit" || error.code === "expired")
        )
          await save({ ...prepared!, submittedAt: undefined });
        throw error;
      }
      requireSuccess(value);
      if (target === "saved_story") {
        const entries = value.saved_stories;
        const entry = Array.isArray(entries) && entries.length === 1 ? entries[0] : undefined;
        const id = entry?.saved_story?.id;
        if (entry?.sub_request_status !== "SUCCESS" || typeof id !== "string" || !guid.test(id))
          throw new SocialPlatformError("unknown");
        await save({ ...prepared!, savedStoryId: id });
        return { platformId: id };
      }
      if (target === "story") {
        // Some responses may carry an exact ID. Persist the hint before read-back so a lost
        // list response does not discard it. The story and Snap still need to match.
        if (typeof value.snap_id === "string" && spotlight.test(value.snap_id)) {
          const id =
            typeof value.story_id === "string" && guid.test(value.story_id)
              ? value.story_id
              : undefined;
          await save({ ...prepared!, storySnapId: value.snap_id, storyId: id });
        }
        const returned = await storyResult(prepared!, token, save);
        if (returned) return returned;
        throw new SocialPlatformError("unknown");
      }
      if (typeof value.spotlight_id !== "string" || !spotlight.test(value.spotlight_id))
        throw new SocialPlatformError("unknown");
      await save({ ...prepared!, spotlightId: value.spotlight_id });
      return result(actorId, value.spotlight_id, token);
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
    async healthCheck(account, token): Promise<{ ok: boolean; code?: SocialErrorCode }> {
      try {
        await identity(account.platformId.toLowerCase(), token);
        return { ok: true };
      } catch (error) {
        if (error instanceof SocialPlatformError) return { ok: false, code: error.code };
        throw error;
      }
    },
    async reconcile(account, job, token) {
      const prepared = job.preparation?.snapchatMedia;
      if (
        !prepared ||
        !snapchatApiProfile(account) ||
        !account.scopes.includes("snapchat-profile-api") ||
        prepared.actorId !== account.platformId.toLowerCase() ||
        prepared.signature !== (await contentSignature(account, job))
      )
        return;
      try {
        if (job.payload.snapchat?.target === "spotlight" && prepared.spotlightId)
          return await result(prepared.actorId, prepared.spotlightId, token);
        if (
          job.payload.snapchat?.target === "saved_story" &&
          prepared.savedStoryId &&
          guid.test(prepared.savedStoryId)
        )
          return { platformId: prepared.savedStoryId };
        if (job.payload.snapchat?.target === "story" && prepared.submittedAt !== undefined)
          return await storyResult(prepared, token);
      } catch {
        return;
      }
    },
  };
}
