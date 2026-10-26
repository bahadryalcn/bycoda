import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { SocialHttp, SocialPlatformError, type SocialSendResult } from "./adapter";

type Preparation = NonNullable<SocialJob["preparation"]>;
type Checkpoint = (state: Preparation) => void | Promise<void>;
const imageUrn = (value: unknown): value is string =>
  typeof value === "string" && /^urn:li:image:[A-Za-z0-9_-]{1,150}$/.test(value);
const postUrn = (value: unknown): value is string =>
  typeof value === "string" && /^urn:li:(?:share|ugcPost):[1-9]\d{0,24}$/.test(value);
const content = (job: Pick<SocialJob, "payload">) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

function authorId(account: Pick<SocialAccount, "platformId">): string {
  const value = account.platformId.replace(/^urn:li:organization:/, "");
  if (!/^[1-9]\d{0,24}$/.test(value)) throw new SocialPlatformError("denied");
  return `urn:li:organization:${value}`;
}

export function linkedInMultiImageIssue(
  account: Pick<SocialAccount, "platform" | "accountType" | "connection">,
  job: Pick<SocialJob, "kind" | "payload">,
): string | undefined {
  if (
    account.platform !== "linkedin" ||
    account.accountType !== "organization" ||
    account.connection === "browser"
  )
    return "LinkedIn API multi-image posts require an organization connection.";
  if (job.kind !== "publish")
    return "LinkedIn API multi-image media is supported for publishing only.";
  const items = job.payload.media;
  if (items.length < 2 || items.length > 4)
    return "LinkedIn API multi-image posts accept two to four uploaded images.";
  if (items.some((item) => item.kind !== "image" || !item.uploadId || item.url || item.title))
    return "LinkedIn API multi-image posts require host-uploaded PNG/JPEG images without document titles.";
  if (new Set(items.map((item) => item.uploadId)).size !== items.length)
    return "Select a distinct upload for each LinkedIn image.";
  if (items.some((item) => (item.alt?.length ?? 0) > 4086))
    return "LinkedIn image alternative text must fit 4086 UTF-16 characters.";
  if (content(job).length > 3000)
    return "LinkedIn commentary including links must fit 3000 UTF-16 characters.";
}

function validateImage(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new SocialPlatformError("rejected");
  const png =
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new SocialPlatformError("rejected");
}

async function signature(account: SocialAccount, job: SocialJob): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      authorId(account),
      job.kind,
      job.payload.text,
      job.payload.link ?? null,
      job.payload.media.map((item) => [item.kind, item.uploadId, item.alt ?? null]),
    ]),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function result(platformId: string): SocialSendResult {
  return {
    platformId,
    url: `https://www.linkedin.com/feed/update/${encodeURIComponent(platformId)}/`,
  };
}

/** Ordinary organization MultiImage posts, with no saved signed URLs or duplicate post on resume. */
export async function publishLinkedInMultiImage(
  http: SocialHttp,
  account: SocialAccount,
  job: SocialJob,
  token: string,
  linkedinVersion: string,
  read: (id: string) => Promise<Uint8Array>,
  checkpoint?: Checkpoint,
  beforeSubmit?: () => Promise<void>,
  now = Date.now,
): Promise<SocialSendResult> {
  if (linkedInMultiImageIssue(account, job) || !/^20\d{4}$/.test(linkedinVersion))
    throw new SocialPlatformError("unsupported");
  if (!account.scopes.includes("w_organization_social")) throw new SocialPlatformError("denied");
  const author = authorId(account);
  const expected = await signature(account, job);
  const previous = job.preparation?.linkedinMedia;
  if (
    previous &&
    (previous.actorId !== author ||
      previous.signature !== expected ||
      !Array.isArray(previous.images) ||
      previous.images.length > job.payload.media.length ||
      previous.images.some(
        (image, index) =>
          !image ||
          !imageUrn(image.id) ||
          image.uploadId !== job.payload.media[index]?.uploadId ||
          !["registered", "uploaded", "ready"].includes(image.status),
      ) ||
      new Set(previous.images.map((image) => image.id)).size !== previous.images.length ||
      (previous.publishedId !== undefined &&
        (!postUrn(previous.publishedId) ||
          previous.images.length !== job.payload.media.length ||
          previous.images.some((image) => image.status !== "ready"))))
  )
    throw new SocialPlatformError("rejected");
  if (!previous && job.preparation?.mediaIds?.length) throw new SocialPlatformError("rejected");
  let state: Preparation = {
    ...job.preparation,
    linkedinMedia: previous
      ? { ...previous, images: previous.images.map((image) => ({ ...image })) }
      : { actorId: author, signature: expected, images: [] },
  };
  const save = async () => {
    job.preparation = {
      ...state,
      linkedinMedia: {
        ...state.linkedinMedia!,
        images: state.linkedinMedia!.images.map((image) => ({ ...image })),
      },
    };
    await checkpoint?.(job.preparation);
  };
  if (state.linkedinMedia!.publishedId) return result(state.linkedinMedia!.publishedId);
  const headers = { "LinkedIn-Version": linkedinVersion, "X-Restli-Protocol-Version": "2.0.0" };
  for (const [index, item] of job.payload.media.entries()) {
    let image = state.linkedinMedia!.images[index];
    let uploadedNow = false;
    if (!image) {
      const bytes = await read(item.uploadId!);
      validateImage(bytes);
      const { value } = await http.json(
        "https://api.linkedin.com/rest/images?action=initializeUpload",
        token,
        { initializeUploadRequest: { owner: author } },
        headers,
      );
      const registered = value.value;
      if (
        !imageUrn(registered?.image) ||
        typeof registered.uploadUrl !== "string" ||
        !Number.isFinite(registered.uploadUrlExpiresAt) ||
        registered.uploadUrlExpiresAt <= now()
      )
        throw new SocialPlatformError("unknown");
      if (state.linkedinMedia!.images.some((entry) => entry.id === registered.image))
        throw new SocialPlatformError("unknown");
      image = { uploadId: item.uploadId!, id: registered.image, status: "registered" };
      state.linkedinMedia!.images.push(image);
      await save();
      await http.uploadLinkedInImage(registered.uploadUrl, token, bytes);
      image.status = "uploaded";
      uploadedNow = true;
      await save();
    }
    const { value: readiness } = await http.request(
      `https://api.linkedin.com/rest/images/${encodeURIComponent(image.id)}`,
      token,
      { headers },
    );
    if (readiness.id !== image.id || readiness.owner !== author)
      throw new SocialPlatformError("denied");
    if (readiness.status === "WAITING_UPLOAD" && image.status === "registered" && !uploadedNow)
      throw new SocialPlatformError("rejected");
    if (["WAITING_UPLOAD", "PROCESSING"].includes(readiness.status))
      throw new SocialPlatformError("processing", now() + 60_000);
    if (readiness.status !== "AVAILABLE") throw new SocialPlatformError("rejected");
    image.status = "ready";
    await save();
  }
  await beforeSubmit?.();
  const { headers: responseHeaders } = await http.json(
    "https://api.linkedin.com/rest/posts",
    token,
    {
      author,
      commentary: content(job),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      content: {
        multiImage: {
          images: state.linkedinMedia!.images.map((image, index) => ({
            id: image.id,
            ...(job.payload.media[index]!.alt ? { altText: job.payload.media[index]!.alt } : {}),
          })),
        },
      },
    },
    headers,
  );
  const publishedId = responseHeaders.get("x-restli-id");
  if (!postUrn(publishedId)) throw new SocialPlatformError("unknown");
  state = { ...state, linkedinMedia: { ...state.linkedinMedia!, publishedId } };
  await save();
  return result(publishedId);
}
