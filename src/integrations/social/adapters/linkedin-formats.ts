import {
  SocialPlatformError,
  type SocialAccount,
  type SocialHttp,
  type SocialJob,
} from "../adapter";

const videosUrl = "https://api.linkedin.com/rest/videos";
const videoUrn = /^urn:li:video:[A-Za-z0-9_-]{1,150}$/;
const videoLimit = 64 * 1024 * 1024;
const partLimit = 4 * 1024 * 1024;
const durations = ["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "FOURTEEN_DAYS"];
type PublishInput = Pick<SocialJob, "kind" | "payload">;

export function linkedInActorId(account: Pick<SocialAccount, "accountType" | "platformId">) {
  const prefix = account.accountType === "organization" ? "urn:li:organization:" : "urn:li:person:";
  const value = account.platformId.startsWith(prefix)
    ? account.platformId.slice(prefix.length)
    : account.platformId;
  if (
    !(
      (account.accountType === "member" && /^[A-Za-z0-9_-]{1,150}$/.test(value)) ||
      (account.accountType === "organization" && /^[1-9]\d{0,24}$/.test(value))
    )
  )
    throw new SocialPlatformError("denied");
  return `${prefix}${value}`;
}

export const linkedInWriteScope = (account: Pick<SocialAccount, "accountType">) =>
  account.accountType === "organization" ? "w_organization_social" : "w_member_social";

export function linkedInFormatIssue(job: PublishInput): string | undefined {
  const format = job.payload.linkedinFormat;
  if (format === undefined) return;
  if (!format || job.kind !== "publish" || job.payload.link)
    return "LinkedIn polls and article cards are standalone publishing formats.";
  if (format.kind === "poll") {
    if (job.payload.media.length) return "LinkedIn polls do not accept attachments.";
    if (
      typeof format.question !== "string" ||
      !format.question.trim() ||
      format.question.length > 140 ||
      !Array.isArray(format.options) ||
      format.options.length < 2 ||
      format.options.length > 4 ||
      format.options.some(
        (option) => typeof option !== "string" || !option.trim() || option.length > 30,
      ) ||
      new Set(format.options.map((option) => option.trim().toLowerCase())).size !==
        format.options.length ||
      !durations.includes(format.duration)
    )
      return "LinkedIn polls require a question up to 140 characters and two to four distinct options up to 30 characters.";
    return;
  }
  if (format.kind !== "article") return "This LinkedIn publishing format is unsupported.";
  const [image] = job.payload.media;
  if (
    job.payload.media.length > 1 ||
    (image &&
      (image.kind !== "image" ||
        !image.uploadId ||
        image.url ||
        image.title ||
        (image.alt?.length ?? 0) > 4085))
  )
    return "LinkedIn article cards accept one uploaded image as a thumbnail.";
  const source = typeof format.source === "string" ? URL.parse(format.source) : null;
  if (
    !source ||
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    format.source.length > 2048
  )
    return "LinkedIn article cards require an HTTPS article URL.";
  if (
    typeof format.title !== "string" ||
    !format.title.trim() ||
    format.title.length > 399 ||
    (format.description !== undefined &&
      (typeof format.description !== "string" || format.description.length > 4085))
  )
    return "LinkedIn article cards require a title up to 399 characters and accept a description up to 4085 characters.";
}

export function linkedInPostContent(
  format: NonNullable<SocialJob["payload"]["linkedinFormat"]>,
  image?: { id: string; altText?: string },
) {
  if (format.kind === "poll")
    return {
      poll: {
        question: format.question,
        options: format.options.map((text) => ({ text })),
        settings: { duration: format.duration },
      },
    };
  return {
    article: {
      source: format.source,
      title: format.title,
      description: format.description,
      ...(image ? { thumbnail: image.id, thumbnailAltText: image.altText } : {}),
    },
  };
}

export function linkedInVideoIssue(job: PublishInput): string | undefined {
  if (!job.payload.media.some((item) => item.kind === "video")) return;
  const [item] = job.payload.media;
  if (
    job.kind !== "publish" ||
    job.payload.media.length !== 1 ||
    !item?.uploadId ||
    item.url ||
    item.alt ||
    item.title
  )
    return "LinkedIn video posts require one uploaded MP4 without alternative text or a document title.";
}

type Part = { firstByte: number; lastByte: number; uploadUrl: string };

function videoParts(instructions: unknown, size: number): Part[] {
  if (
    !Array.isArray(instructions) ||
    !instructions.length ||
    instructions.length > Math.ceil(size / partLimit)
  )
    throw new SocialPlatformError("unknown");
  let start = 0;
  const urls = new Set<string>();
  const parts: Part[] = instructions.map((part) => {
    if (
      !part ||
      part.firstByte !== start ||
      start >= size ||
      !Number.isSafeInteger(part.lastByte) ||
      part.lastByte < start ||
      part.lastByte >= start + partLimit ||
      typeof part.uploadUrl !== "string" ||
      urls.has(part.uploadUrl)
    )
      throw new SocialPlatformError("unknown");
    // LinkedIn can return the full part boundary even for the short final part.
    const lastByte = Math.min(size - 1, part.lastByte);
    const range = { firstByte: start, lastByte, uploadUrl: part.uploadUrl };
    urls.add(part.uploadUrl);
    start = lastByte + 1;
    return range;
  });
  if (start !== size) throw new SocialPlatformError("unknown");
  return parts;
}

function partId(etag: string | undefined): string {
  // LinkedIn returns opaque signed part IDs, sometimes surrounded by HTTP quotes.
  const value = etag?.replace(/^"([^"]+)"$/, "$1");
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_./+=-]+$/.test(value))
    throw new SocialPlatformError("unknown");
  return value;
}

export async function prepareLinkedInVideo(
  http: SocialHttp,
  author: string,
  job: SocialJob,
  token: string,
  headers: Record<string, string>,
  read: (id: string) => Promise<Uint8Array>,
  checkpoint?: (state: NonNullable<SocialJob["preparation"]>) => void | Promise<void>,
): Promise<string> {
  let videoId = job.preparation?.mediaIds?.[0];
  if (
    job.preparation?.mediaIds &&
    (job.preparation.mediaIds.length !== 1 || !videoId || !videoUrn.test(videoId))
  )
    throw new SocialPlatformError("rejected");
  if (!videoId) {
    const bytes = await read(job.payload.media[0]!.uploadId!);
    if (
      bytes.byteLength < 75_000 ||
      bytes.byteLength > videoLimit ||
      new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp"
    )
      throw new SocialPlatformError("rejected");
    const { value } = await http.json(
      `${videosUrl}?action=initializeUpload`,
      token,
      {
        initializeUploadRequest: {
          owner: author,
          fileSizeBytes: bytes.byteLength,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
      headers,
    );
    const upload = value.value;
    if (
      typeof upload?.video !== "string" ||
      !videoUrn.test(upload.video) ||
      typeof upload.uploadToken !== "string" ||
      !Number.isSafeInteger(upload.uploadUrlsExpireAt) ||
      upload.uploadUrlsExpireAt <= Date.now()
    )
      throw new SocialPlatformError("unknown");
    const uploadedPartIds: string[] = [];
    for (const part of videoParts(upload.uploadInstructions, bytes.byteLength)) {
      const { etag } = await http.uploadLinkedInImage(
        part.uploadUrl,
        undefined,
        bytes.subarray(part.firstByte, part.lastByte + 1),
      );
      uploadedPartIds.push(partId(etag));
    }
    videoId = String(upload.video);
    await http.json(
      `${videosUrl}?action=finalizeUpload`,
      token,
      {
        finalizeUploadRequest: { video: videoId, uploadToken: upload.uploadToken, uploadedPartIds },
      },
      headers,
    );
    await checkpoint?.({ mediaIds: [videoId] });
  }
  const { value: readiness } = await http.request(
    `${videosUrl}/${encodeURIComponent(videoId)}`,
    token,
    { headers },
  );
  if (readiness.id !== videoId || readiness.owner !== author)
    throw new SocialPlatformError("denied");
  if (["WAITING_UPLOAD", "PROCESSING"].includes(readiness.status))
    throw new SocialPlatformError("processing", Date.now() + 60_000);
  if (readiness.status !== "AVAILABLE") throw new SocialPlatformError("rejected");
  return videoId;
}
