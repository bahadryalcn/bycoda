export type MediaKind = "video" | "audio";

/** Format routing only; the native player validates actual container/codec support. */
export function mediaKind(path: string): MediaKind | null {
  if (/\.(mp4|m4v|webm|mov|ogv|mkv|avi)$/i.test(path)) return "video";
  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(path)) return "audio";
  return null;
}
