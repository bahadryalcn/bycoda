/** File-backed chat backgrounds retain the existing path preference and scope. */
export function chatBackgroundKind(path: string | null | undefined): "image" | "video" | "html" {
  const extension = path?.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "mp4" || extension === "webm") return "video";
  return "image";
}
