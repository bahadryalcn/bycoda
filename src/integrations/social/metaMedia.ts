import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { SocialHttp, SocialPlatformError, type SocialSendResult } from "./adapter";

type Platform = "instagram" | "facebook";
type Preparation = NonNullable<SocialJob["preparation"]>;
type Checkpoint = (state: Preparation) => void | Promise<void>;
const lifetime = 24 * 60 * 60_000;
const content = (job: Pick<SocialJob, "payload">) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

function https(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4000) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

/** Conservative local bounds; Meta still validates the fetched file and account permissions. */
export function metaPublishingIssue(
  platform: Platform,
  job: Pick<SocialJob, "kind" | "payload">,
): string | undefined {
  if (job.kind !== "publish") return "Meta media preparation supports publication only.";
  const items = job.payload.media;
  if (items.length > 4 || (platform === "instagram" && !items.length))
    return "Instagram requires one to four media items; Facebook accepts up to four images.";
  if (
    items.some(
      (item) =>
        !https(item.url) || !!item.uploadId || (item.kind !== "image" && item.kind !== "video"),
    )
  )
    return "Meta API publishing requires public HTTPS image or video URLs.";
  if (items.some((item) => item.alt && (item.kind !== "image" || item.alt.length > 1000)))
    return "Meta alternative text accepts images and up to 1000 characters.";
  if (platform === "facebook" && items.some((item) => item.kind !== "image"))
    return "Facebook API media publishing currently accepts images; video publication is unavailable.";
  if (platform === "instagram" && content(job).length > 2200)
    return "Instagram captions, including links, must fit 2200 characters.";
  return undefined;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,300}$/.test(value))
    throw new SocialPlatformError("unknown");
  return value;
}
const pathId = (value: string) => encodeURIComponent(identifier(value));
const permalink = (platform: Platform, value: unknown): string | undefined => {
  if (!https(value)) return;
  const parsed = new URL(value);
  if (parsed.origin !== `https://www.${platform}.com`) return;
  return parsed.toString();
};

async function signature(
  platform: Platform,
  account: SocialAccount,
  job: SocialJob,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      platform,
      account.platformId,
      job.kind,
      job.payload.text,
      job.payload.link ?? null,
      job.payload.media.map((item) => [item.kind, item.url, item.alt ?? null]),
    ]),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Meta's container/child and unpublished-photo flows. Preparation IDs are saved
 * before proceeding; a publish ID is saved before the optional permalink read.
 * The official Meta SDK defines these parameters on IGUser.create_media,
 * IGUser.create_media_publish, Page.create_photo and Page.create_feed.
 */
export async function publishMetaMedia(
  http: SocialHttp,
  platform: Platform,
  account: SocialAccount,
  job: SocialJob,
  token: string,
  graphVersion: string,
  checkpoint?: Checkpoint,
  beforeSubmit?: () => Promise<void>,
  now = Date.now,
): Promise<SocialSendResult> {
  if (
    account.platform !== platform ||
    account.connection === "browser" ||
    account.accountType !== (platform === "instagram" ? "professional" : "page")
  )
    throw new SocialPlatformError("denied");
  if (!/^v\d+\.0$/.test(graphVersion) || metaPublishingIssue(platform, job))
    throw new SocialPlatformError("unsupported");
  const origin = `https://graph.${platform === "instagram" ? "instagram" : "facebook"}.com`;
  const endpoint = (path: string) => `${origin}/${graphVersion}/${path}`;
  const actor = pathId(account.platformId);
  const expectedSignature = await signature(platform, account, job);
  let state: Preparation = { ...job.preparation };
  if (state.containerId) identifier(state.containerId);
  for (const mediaId of state.mediaIds ?? []) identifier(mediaId);
  const previous = state.metaMedia;
  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new SocialPlatformError("rejected");
  if (previous) {
    if (
      previous.platform !== platform ||
      previous.actorId !== account.platformId ||
      previous.signature !== expectedSignature ||
      !Number.isFinite(previous.startedAt) ||
      previous.startedAt > startedAt + 5 * 60_000
    )
      throw new SocialPlatformError("denied");
    if (!previous.publishedId && startedAt - previous.startedAt >= lifetime)
      throw new SocialPlatformError("rejected");
  } else {
    // Preserve the old single-image Instagram container checkpoint. Other
    // unbound IDs cannot be safely reinterpreted as carousel/photo preparation.
    if (
      state.mediaIds?.length ||
      (state.containerId &&
        (platform !== "instagram" ||
          job.payload.media.length !== 1 ||
          job.payload.media[0]?.kind !== "image"))
    )
      throw new SocialPlatformError("unknown");
    state.metaMedia = {
      platform,
      actorId: account.platformId,
      signature: expectedSignature,
      startedAt,
    };
  }
  const save = async () => {
    job.preparation = { ...state, mediaIds: state.mediaIds ? [...state.mediaIds] : undefined };
    await checkpoint?.(job.preparation);
  };
  const result = async (publishedId: string): Promise<SocialSendResult> => {
    const platformId = identifier(publishedId);
    if (platform === "facebook")
      return { platformId, url: `https://www.facebook.com/${pathId(platformId)}` };
    const details = await http
      .request(endpoint(`${pathId(platformId)}?fields=permalink`), token)
      .catch(() => undefined);
    return { platformId, url: permalink(platform, details?.value.permalink) };
  };
  if (previous?.publishedId) return result(previous.publishedId);
  await save();
  const ready = async (containerId: string) => {
    const { value } = await http.request(
      endpoint(`${pathId(containerId)}?fields=status_code`),
      token,
    );
    if (value.status_code === "IN_PROGRESS")
      throw new SocialPlatformError("rate_limit", now() + 60_000);
    if (value.status_code === "ERROR" || value.status_code === "EXPIRED")
      throw new SocialPlatformError("rejected");
    if (value.status_code !== "FINISHED") throw new SocialPlatformError("unknown");
  };
  const items = job.payload.media;
  if (platform === "instagram") {
    if (!state.containerId) {
      const carousel = items.length > 1;
      if (carousel) {
        const ids = [...(state.mediaIds ?? [])];
        if (ids.length > items.length) throw new SocialPlatformError("unknown");
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          if (!ids[index]) {
            const { value } = await http.json(endpoint(`${actor}/media`), token, {
              ...(item.kind === "image"
                ? { image_url: item.url, ...(item.alt ? { alt_text: item.alt } : {}) }
                : { media_type: "VIDEO", video_url: item.url }),
              is_carousel_item: true,
            });
            ids[index] = identifier(value.id);
            state.mediaIds = [...ids];
            await save();
          }
          await ready(ids[index]);
        }
        const { value } = await http.json(endpoint(`${actor}/media`), token, {
          media_type: "CAROUSEL",
          children: ids,
          caption: content(job),
        });
        state.containerId = identifier(value.id);
      } else {
        const item = items[0];
        const { value } = await http.json(endpoint(`${actor}/media`), token, {
          ...(item.kind === "image"
            ? { image_url: item.url, ...(item.alt ? { alt_text: item.alt } : {}) }
            : { media_type: "REELS", video_url: item.url, share_to_feed: true }),
          caption: content(job),
        });
        state.containerId = identifier(value.id);
      }
      await save();
    }
    await ready(state.containerId);
    await beforeSubmit?.();
    const { value } = await http.json(endpoint(`${actor}/media_publish`), token, {
      creation_id: state.containerId,
    });
    const publishedId = identifier(value.id);
    state = { ...state, metaMedia: { ...state.metaMedia!, publishedId } };
    try {
      await save();
    } catch {
      throw new SocialPlatformError("unknown");
    }
    return result(publishedId);
  }
  const ids = [...(state.mediaIds ?? [])];
  if (ids.length > items.length) throw new SocialPlatformError("unknown");
  for (let index = ids.length; index < items.length; index++) {
    const item = items[index];
    const { value } = await http.json(endpoint(`${actor}/photos`), token, {
      url: item.url,
      published: false,
      ...(item.alt ? { alt_text_custom: item.alt } : {}),
    });
    ids.push(identifier(value.id));
    state.mediaIds = [...ids];
    await save();
  }
  await beforeSubmit?.();
  const { value } = await http.json(
    endpoint(`${actor}/feed`),
    token,
    items.length
      ? { message: content(job), attached_media: ids.map((media_fbid) => ({ media_fbid })) }
      : { message: job.payload.text, ...(job.payload.link ? { link: job.payload.link } : {}) },
  );
  const publishedId = identifier(value.id);
  state = { ...state, metaMedia: { ...state.metaMedia!, publishedId } };
  try {
    await save();
  } catch {
    throw new SocialPlatformError("unknown");
  }
  return result(publishedId);
}
