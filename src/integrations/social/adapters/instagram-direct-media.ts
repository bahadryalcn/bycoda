/** Instagram Login accepts one audio, video or PDF attachment in a message. */
export const INSTAGRAM_DIRECT_MEDIA_KINDS = ["image", "video", "audio", "document"] as const;
export type InstagramDirectMediaKind = (typeof INSTAGRAM_DIRECT_MEDIA_KINDS)[number];

export const INSTAGRAM_DIRECT_MEDIA_LIMITS: Record<InstagramDirectMediaKind, number> = {
  image: 8_000_000,
  video: 25_000_000,
  audio: 25_000_000,
  document: 25_000_000,
};

export const INSTAGRAM_DIRECT_FILE_ACCEPT: Record<InstagramDirectMediaKind, string> = {
  image: "image/jpeg,image/png",
  video: "video/mp4,video/webm,video/quicktime,video/ogg,video/x-msvideo",
  audio: "audio/aac,audio/mp4,audio/x-m4a,audio/wav,.m4a",
  document: "application/pdf,.pdf",
};

export function isInstagramDirectMediaKind(value: unknown): value is InstagramDirectMediaKind {
  return INSTAGRAM_DIRECT_MEDIA_KINDS.some((kind) => kind === value);
}
