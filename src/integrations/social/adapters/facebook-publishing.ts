import {
  SocialPlatformError,
  type SocialAccount,
  type SocialAdapter,
  type SocialHttp,
  type SocialJob,
} from "../adapter";
import { metaPublishingIssue, publishMetaMedia } from "../metaMedia";
import { facebookScheduleTime } from "./facebook-schedule";
import {
  confirmFacebookStory,
  prepareFacebookStory,
  storyPostId,
  submitFacebookStory,
} from "./facebook-stories";
import {
  confirmFacebookVideo,
  facebookHttpsMedia,
  facebookNumericId,
  readFacebookVideo,
  submitFacebookVideo,
} from "./facebook-video";

type PublishJob = Pick<SocialJob, "kind" | "payload">;
type Preparation = NonNullable<NonNullable<SocialJob["preparation"]>["facebookMedia"]>;

export function facebookPublishingIssue(
  account: SocialAccount,
  job: PublishJob,
): string | undefined {
  const options = job.payload.facebook;
  if (
    !options ||
    job.kind !== "publish" ||
    account.platform !== "facebook" ||
    account.accountType !== "page" ||
    account.connection === "browser" ||
    !facebookNumericId(account.platformId)
  )
    return "Facebook publishing formats require an API-connected Page.";
  const validOptions = (keys: string[]) => Object.keys(options).every((key) => keys.includes(key));
  if (options.target === "feed") {
    if (
      !validOptions(["target", "scheduledPublishAt"]) ||
      !Number.isSafeInteger(options.scheduledPublishAt)
    )
      return "Invalid Facebook scheduling options.";
    return metaPublishingIssue("facebook", job);
  }
  const [media] = job.payload.media;
  if (job.payload.media.length !== 1) return "Attach exactly one media item.";
  if (options.target === "story") {
    if (!validOptions(["target"]) || job.payload.text.trim() || job.payload.link)
      return "Facebook Stories accept only the attached photo or video.";
    if (
      (media.kind === "image" &&
        (media.uploadId || facebookHttpsMedia(media.url)) &&
        (!media.alt || media.alt.length <= 1000)) ||
      (media.kind === "video" && media.uploadId && !media.url && !media.alt)
    )
      return;
    return "A Facebook Story requires one HTTPS image or uploaded MP4.";
  }
  if (
    options.target !== "video" ||
    !validOptions(["target", "scheduledPublishAt"]) ||
    (options.scheduledPublishAt !== undefined && !Number.isSafeInteger(options.scheduledPublishAt))
  )
    return "Invalid Facebook video options.";
  if (
    media.kind !== "video" ||
    media.alt ||
    !(media.uploadId ? !media.url : facebookHttpsMedia(media.url))
  )
    return "A Facebook video requires one hosted or uploaded MP4.";
  if ([job.payload.text, job.payload.link].filter(Boolean).join("\n").length > 63_206)
    return "Facebook text, including links, must fit 63,206 characters.";
}

export function createFacebookPublishing(
  http: SocialHttp,
  version: string,
  now = Date.now,
): Pick<SocialAdapter, "send" | "reconcile"> {
  if (!/^v\d{1,3}\.\d{1,2}$/.test(version)) throw new SocialPlatformError("unsupported");
  const endpoint = `https://graph.facebook.com/${version}`;

  async function prepare(account: SocialAccount, job: SocialJob, token: string) {
    if (facebookPublishingIssue(account, job)) throw new SocialPlatformError("unsupported");
    if (
      !["pages_manage_posts", "pages_read_engagement", "pages_show_list"].every((scope) =>
        account.scopes.includes(scope),
      )
    )
      throw new SocialPlatformError("denied");
    const { value } = await http.request(`${endpoint}/me?fields=id`, token);
    if (value.id !== account.platformId) throw new SocialPlatformError("denied");
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([account.platformId, job.payload])),
    );
    const signature = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const previous = job.preparation?.facebookMedia;
    if (
      previous &&
      (previous.actorId !== account.platformId ||
        previous.signature !== signature ||
        (previous.mediaId !== undefined && !facebookNumericId(previous.mediaId)))
    )
      throw new SocialPlatformError("denied");
    return { previous, signature };
  }

  async function receipt(
    account: SocialAccount,
    job: SocialJob,
    token: string,
    state: Preparation,
  ) {
    const options = job.payload.facebook;
    if (options?.target === "video" && state.mediaId)
      return confirmFacebookVideo(
        http,
        endpoint,
        account.platformId,
        token,
        state.mediaId,
        options.scheduledPublishAt,
        now(),
      );
    if (options?.target === "story" && state.mediaId) {
      if (state.postId) return { platformId: storyPostId(state.postId) };
      return confirmFacebookStory(
        http,
        `${endpoint}/${account.platformId}`,
        token,
        job.payload.media[0],
        state.mediaId,
      );
    }
    throw new SocialPlatformError("unknown");
  }

  return {
    async send(account, job, token, read, checkpoint, beforeSubmit) {
      const { previous, signature } = await prepare(account, job, token);
      const options = job.payload.facebook!;
      if (previous?.stage === "submitted") return receipt(account, job, token, previous);
      if (options.target === "feed")
        return publishMetaMedia(
          http,
          "facebook",
          account,
          job,
          token,
          version,
          checkpoint,
          beforeSubmit,
          now,
          read,
        );
      if (options.target !== "video" && options.target !== "story")
        throw new SocialPlatformError("unsupported");
      if (job.preparation && !previous) throw new SocialPlatformError("denied");
      const save = async (stage: Preparation["stage"], mediaId?: string, postId?: string) => {
        const state: Preparation = {
          actorId: account.platformId,
          signature,
          stage,
          mediaId,
          postId,
        };
        job.preparation = { ...job.preparation, facebookMedia: state };
        await checkpoint?.(job.preparation);
        return state;
      };
      const media = job.payload.media[0];
      if (options.target === "video") {
        if (previous) throw new SocialPlatformError("unknown");
        const bytes = media.uploadId ? await readFacebookVideo(media.uploadId, read) : undefined;
        if (
          options.scheduledPublishAt !== undefined &&
          facebookScheduleTime(options.scheduledPublishAt, now()) === undefined
        )
          throw new SocialPlatformError("rejected");
        await beforeSubmit?.();
        await save("submitted");
        await beforeSubmit?.();
        const mediaId = await submitFacebookVideo(
          http,
          version,
          account.platformId,
          token,
          job.payload,
          bytes,
          now(),
        );
        return receipt(account, job, token, await save("submitted", mediaId));
      }

      const bytes =
        media.kind === "video" && (!previous || previous.stage === "created")
          ? await readFacebookVideo(media.uploadId!, read)
          : undefined;
      const mediaId =
        previous?.mediaId ??
        (await (async () => {
          const id = await prepareFacebookStory(
            http,
            endpoint,
            version,
            account.platformId,
            token,
            media,
            read,
            beforeSubmit,
          );
          await save("created", id);
          return id;
        })());
      if (media.kind === "video" && previous?.stage !== "uploaded") {
        if (previous?.stage === "uploading") {
          const { value } = await http.request(`${endpoint}/${mediaId}?fields=id,status`, token);
          if (value.id !== mediaId || value.status?.uploading_phase?.status !== "complete")
            throw new SocialPlatformError("unknown");
        } else {
          if (!bytes) throw new SocialPlatformError("unknown");
          await save("uploading", mediaId);
          await beforeSubmit?.();
          await http.uploadFacebookReel(version, mediaId, token, bytes);
        }
        await save("uploaded", mediaId);
      }
      await beforeSubmit?.();
      await save("submitted", mediaId);
      await beforeSubmit?.();
      const postId = await submitFacebookStory(
        http,
        `${endpoint}/${account.platformId}`,
        token,
        media,
        mediaId,
      );
      await save("submitted", mediaId, postId);
      return { platformId: postId };
    },
    async reconcile(account, job, token) {
      const { previous } = await prepare(account, job, token);
      if (previous?.stage === "submitted") return receipt(account, job, token, previous);
      if (job.payload.facebook?.target === "feed" && job.preparation?.metaMedia?.publishedId)
        return publishMetaMedia(
          http,
          "facebook",
          account,
          job,
          token,
          version,
          undefined,
          undefined,
          now,
        );
      return undefined;
    },
  };
}
