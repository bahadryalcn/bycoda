import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialSendResult,
} from "./adapter";
import { xMediaFormat } from "./xMedia";

const origin = "https://businessapi.snapchat.com";
const guid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const spotlight = /^[A-Za-z0-9_-]{8,200}$/;
const maxAge = 24 * 60 * 60_000;
const partSize = 32 * 1024 * 1024;
type Prepared = NonNullable<NonNullable<SocialJob["preparation"]>["snapchatMedia"]>;

/** Public Profile API IDs are UUIDs; browser usernames/profile markers are not API identities. */
export function snapchatContentIssue(
  account: SocialAccount,
  job: Pick<SocialJob, "payload" | "kind">,
): string | undefined {
  if (
    account.platform !== "snapchat" ||
    account.connection === "browser" ||
    account.accountType !== "public_profile" ||
    !guid.test(account.platformId)
  )
    return "Snapchat API publishing requires an OAuth-verified Public Profile UUID.";
  if (job.kind !== "publish" || job.payload.snapchat?.target !== "spotlight")
    return "This Snapchat API adapter publishes Spotlight videos only. Story submissions do not provide an exact posted-Snap receipt.";
  const options = job.payload.snapchat;
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
  if (
    job.payload.media.length !== 1 ||
    job.payload.media[0].kind !== "video" ||
    !job.payload.media[0].uploadId ||
    job.payload.media[0].url ||
    job.payload.media[0].alt ||
    job.payload.media[0].title
  )
    return "Snapchat API Spotlight requires one owner-uploaded MP4 video.";
  if (job.payload.text.length > 160)
    return "Snapchat Spotlight descriptions must fit 160 characters.";
  if (job.payload.link) {
    try {
      const url = new URL(job.payload.link);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        return "Spotlight links must be full HTTP or HTTPS URLs without credentials.";
    } catch {
      return "Spotlight links must be full HTTP or HTTPS URLs without credentials.";
    }
  }
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
  async function identity(actorId: string, token: string) {
    const { value } = await http.request(`${origin}/v1/public_profiles/my_profile`, token);
    requireSuccess(value);
    if (
      typeof value.public_profile?.id !== "string" ||
      value.public_profile.id.toLowerCase() !== actorId
    )
      throw new SocialPlatformError("denied");
  }
  async function result(actorId: string, id: string, token: string): Promise<SocialSendResult> {
    if (!spotlight.test(id)) throw new SocialPlatformError("unknown");
    const { value } = await http.request(
      `${origin}/v1/public_profiles/${actorId}/spotlights/${encodeURIComponent(id)}`,
      token,
    );
    requireSuccess(value);
    if (!Array.isArray(value.spotlights) || value.spotlights.length !== 1)
      throw new SocialPlatformError("unknown");
    const entry = value.spotlights[0],
      post = entry?.spotlight;
    if (
      entry.sub_request_status !== "SUCCESS" ||
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
  return {
    async send(account, job, token, read, checkpoint, beforeSubmit) {
      if (snapchatContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      if (!account.scopes.includes("snapchat-profile-api")) throw new SocialPlatformError("denied");
      const actorId = account.platformId.toLowerCase(),
        signature = await contentSignature(account, job);
      let prepared = job.preparation?.snapchatMedia;
      if (
        prepared &&
        (prepared.actorId !== actorId ||
          prepared.signature !== signature ||
          !guid.test(prepared.mediaId) ||
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
      if (prepared?.spotlightId) return result(actorId, prepared.spotlightId, token);
      if (!checkpoint) throw new SocialPlatformError("unsupported");
      if (prepared && prepared.createdAt + maxAge <= now())
        throw new SocialPlatformError("rejected");
      await identity(actorId, token);
      if (!prepared) {
        const bytes = await read(job.payload.media[0].uploadId!);
        if (xMediaFormat(bytes) !== "mp4") throw new SocialPlatformError("unsupported");
        const keyBytes = crypto.getRandomValues(new Uint8Array(32));
        const iv = crypto.getRandomValues(new Uint8Array(16));
        const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt"]);
        const encrypted = new Uint8Array(
          await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, new Uint8Array(bytes)),
        );
        const createdAt = now();
        const { value: media } = await http.json(
          `${origin}/v1/public_profiles/${actorId}/media`,
          token,
          {
            type: "VIDEO",
            name: `bycoda-${job.id}`,
            key: btoa(String.fromCharCode(...keyBytes)),
            iv: btoa(String.fromCharCode(...iv)),
          },
        );
        keyBytes.fill(0);
        iv.fill(0);
        requireSuccess(media);
        if (typeof media.media_id !== "string" || !guid.test(media.media_id))
          throw new SocialPlatformError("unknown");
        const mediaId = media.media_id.toLowerCase();
        const add = uploadPath(media.add_path, actorId, mediaId),
          finalize = uploadPath(media.finalize_path, actorId, mediaId);
        if (add !== finalize) throw new SocialPlatformError("denied");
        for (let offset = 0, part = 1; offset < encrypted.length; offset += partSize, part++) {
          const form = new FormData();
          form.set("action", "ADD");
          form.set("part_number", String(part));
          form.set(
            "file",
            new Blob([encrypted.slice(offset, offset + partSize)], {
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
        await save({ actorId, signature, mediaId, createdAt });
      }
      await identity(actorId, token);
      await beforeSubmit?.();
      const { value } = await http.json(
        `${origin}/v1/public_profiles/${actorId}/spotlights`,
        token,
        {
          media_id: prepared!.mediaId,
          locale: job.payload.snapchat!.locale,
          ...(job.payload.text ? { description: job.payload.text } : {}),
          ...(job.payload.link ? { link: job.payload.link } : {}),
        },
      );
      requireSuccess(value);
      if (typeof value.spotlight_id !== "string" || !spotlight.test(value.spotlight_id))
        throw new SocialPlatformError("unknown");
      await save({ ...prepared!, spotlightId: value.spotlight_id });
      return result(actorId, value.spotlight_id, token);
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
    async reconcile(account, job, token) {
      const prepared = job.preparation?.snapchatMedia;
      if (
        !prepared?.spotlightId ||
        !guid.test(account.platformId) ||
        prepared.actorId !== account.platformId.toLowerCase() ||
        prepared.signature !== (await contentSignature(account, job))
      )
        return;
      try {
        return await result(prepared.actorId, prepared.spotlightId, token);
      } catch {
        return;
      }
    },
  };
}
