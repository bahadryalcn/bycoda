import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialSendResult,
} from "./adapter";

const numericId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d{0,24}$/.test(value);
const caption = (job: Pick<SocialJob, "payload">) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");
type Prepared = NonNullable<NonNullable<SocialJob["preparation"]>["facebookReel"]>;

/** Explicit Reels target; never reinterpret an ordinary Page video as a Reel. */
export function facebookReelContentIssue(
  account: SocialAccount,
  job: Pick<SocialJob, "kind" | "payload">,
): string | undefined {
  if (
    account.platform !== "facebook" ||
    account.accountType !== "page" ||
    account.connection === "browser" ||
    !numericId(account.platformId)
  )
    return "Facebook Reels require an API-connected Page.";
  const options = job.payload.facebook;
  if (job.kind !== "publish" || !options || options.target !== "reel")
    return "Select the explicit Facebook Reel destination.";
  if (
    Object.keys(options).some(
      (key) => !["target", "durationSeconds", "width", "height", "frameRate"].includes(key),
    )
  )
    return "Unsupported Facebook Reel options.";
  if (
    !Number.isFinite(options.durationSeconds) ||
    options.durationSeconds < 4 ||
    options.durationSeconds > 60 ||
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width < 540 ||
    options.height < 960 ||
    options.width * 16 !== options.height * 9 ||
    !Number.isFinite(options.frameRate) ||
    options.frameRate < 23
  )
    return "Facebook Reels require a 4–60 second, 9:16 MP4 of at least 540 × 960 pixels and 23 frames per second.";
  const media = job.payload.media;
  if (
    media.length !== 1 ||
    media[0].kind !== "video" ||
    !media[0].uploadId ||
    media[0].url ||
    media[0].alt ||
    media[0].title
  )
    return "Facebook Reels require one owner-uploaded MP4 up to 64 MiB.";
  if (caption(job).length > 2200)
    return "Facebook Reel descriptions including links must fit 2200 UTF-16 characters.";
}

async function signature(account: SocialAccount, job: SocialJob): Promise<string> {
  const value = JSON.stringify([account.platformId, job.kind, job.payload]);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Meta's official Reels start/upload/finish contract. Status is reconciled by exact video ID. */
export function createFacebookReelsAdapter(
  http: SocialHttp,
  graphVersion: string,
  now = Date.now,
): SocialAdapter {
  if (!/^v\d{1,3}\.\d{1,2}$/.test(graphVersion)) throw new SocialPlatformError("unsupported");
  const endpoint = (path: string) => `https://graph.facebook.com/${graphVersion}/${path}`;
  async function identity(account: SocialAccount, token: string): Promise<void> {
    const { value } = await http.request(endpoint("me?fields=id"), token);
    if (value.id !== account.platformId) throw new SocialPlatformError("denied");
  }
  async function state(account: SocialAccount, job: SocialJob): Promise<Prepared | undefined> {
    if (facebookReelContentIssue(account, job)) throw new SocialPlatformError("unsupported");
    if (
      !["pages_manage_posts", "pages_read_engagement"].every((scope) =>
        account.scopes.includes(scope),
      )
    )
      throw new SocialPlatformError("denied");
    const previous = job.preparation?.facebookReel;
    if (
      previous &&
      (previous.actorId !== account.platformId ||
        previous.signature !== (await signature(account, job)) ||
        !numericId(previous.videoId) ||
        !["created", "uploading", "uploaded", "submitted"].includes(previous.stage) ||
        !Number.isFinite(previous.createdAt) ||
        previous.createdAt > now() ||
        previous.createdAt < now() - 24 * 60 * 60_000)
    )
      throw new SocialPlatformError("rejected");
    if (!previous && job.preparation && Object.keys(job.preparation).length)
      throw new SocialPlatformError("rejected");
    return previous;
  }
  async function receipt(
    account: SocialAccount,
    prepared: Prepared,
    token: string,
  ): Promise<SocialSendResult> {
    const { value } = await http.request(
      endpoint(`${prepared.videoId}?fields=id,from,published,status,permalink_url`),
      token,
    );
    if (value.id !== prepared.videoId || value.from?.id !== account.platformId)
      throw new SocialPlatformError("unknown");
    const status = value.status;
    const phases = [status?.uploading_phase, status?.processing_phase, status?.publishing_phase];
    if (
      ["error", "upload_failed", "expired"].includes(status?.video_status) ||
      phases.some((phase) => phase?.status === "error" || phase?.errors?.length)
    )
      throw new SocialPlatformError("rejected");
    // Neither success:true from finish nor video_status:ready proves publication.
    if (value.published === true && status?.publishing_phase?.status === "complete") {
      let url: string | undefined;
      try {
        const candidate = new URL(value.permalink_url);
        const exactPath =
          candidate.pathname === `/reel/${prepared.videoId}` ||
          candidate.pathname === `/reel/${prepared.videoId}/` ||
          new RegExp(`^/(?:[^/]+/)?videos/${prepared.videoId}/?$`).test(candidate.pathname);
        const exactQuery =
          ["/video.php", "/watch", "/watch/"].includes(candidate.pathname) &&
          candidate.searchParams.get("v") === prepared.videoId &&
          [...candidate.searchParams.keys()].every((key) => key === "v");
        if (
          candidate.origin === "https://www.facebook.com" &&
          !candidate.username &&
          !candidate.password &&
          !candidate.hash &&
          ((exactPath && !candidate.search) || exactQuery)
        )
          url = candidate.href;
      } catch {
        /* The exact video ID is the receipt even without a public permalink. */
      }
      return { platformId: prepared.videoId, ...(url ? { url } : {}) };
    }
    if (status?.publishing_phase?.status === "complete") throw new SocialPlatformError("unknown");
    if (
      ["uploading", "upload_complete", "processing", "ready"].includes(status?.video_status) &&
      ["not_started", "in_progress"].includes(status?.publishing_phase?.status)
    )
      throw new SocialPlatformError("processing", now() + 60_000);
    throw new SocialPlatformError("unknown");
  }
  return {
    async send(account, job, token, read, checkpoint, beforeSubmit) {
      let prepared = await state(account, job);
      await identity(account, token);
      if (prepared?.stage === "submitted") return receipt(account, prepared, token);
      const save = async (next: Prepared) => {
        prepared = { ...next };
        job.preparation = { ...job.preparation, facebookReel: prepared };
        await checkpoint?.(job.preparation);
      };
      // An interrupted transfer cannot be repeated until Meta positively acknowledges it.
      if (prepared?.stage === "uploading") {
        const { value } = await http.request(
          endpoint(`${prepared.videoId}?fields=id,status`),
          token,
        );
        if (value.id !== prepared.videoId || value.status?.uploading_phase?.status !== "complete")
          throw new SocialPlatformError("unknown");
        await save({ ...prepared, stage: "uploaded" });
      }
      if (!prepared || prepared.stage === "created") {
        const bytes = await read(job.payload.media[0].uploadId!);
        if (
          bytes.length < 12 ||
          bytes.length > 64 * 1024 * 1024 ||
          new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp"
        )
          throw new SocialPlatformError("unsupported");
        await identity(account, token);
        await beforeSubmit?.();
        if (!prepared) {
          const { value } = await http.json(endpoint(`${account.platformId}/video_reels`), token, {
            upload_phase: "start",
          });
          if (
            !numericId(value.video_id) ||
            value.upload_url !==
              `https://rupload.facebook.com/video-upload/${graphVersion}/${value.video_id}`
          )
            throw new SocialPlatformError("unknown");
          await save({
            actorId: account.platformId,
            signature: await signature(account, job),
            videoId: value.video_id,
            stage: "created",
            createdAt: now(),
          });
        }
        await save({ ...prepared!, stage: "uploading" });
        await beforeSubmit?.();
        await http.uploadFacebookReel(graphVersion, prepared!.videoId, token, bytes);
        await save({ ...prepared!, stage: "uploaded" });
      }
      await identity(account, token);
      await beforeSubmit?.();
      // Persist before the consequential finish: crashes and uncertain responses only read this ID.
      await save({ ...prepared!, stage: "submitted" });
      await beforeSubmit?.();
      const { value } = await http.json(endpoint(`${account.platformId}/video_reels`), token, {
        video_id: prepared!.videoId,
        upload_phase: "finish",
        video_state: "PUBLISHED",
        description: caption(job),
      });
      if (value.success !== true) throw new SocialPlatformError("unknown");
      return receipt(account, prepared!, token);
    },
    async reconcile(account, job, token) {
      const prepared = await state(account, job);
      if (!prepared || prepared.stage !== "submitted") return undefined;
      await identity(account, token);
      return receipt(account, prepared, token);
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
  };
}
