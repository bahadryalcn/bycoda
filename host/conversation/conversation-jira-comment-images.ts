import { lstat } from "node:fs/promises";
import { basename, extname, relative } from "node:path";
import {
  JIRA_COMMENT_IMAGE_BYTES,
  JIRA_COMMENT_IMAGE_COUNT,
} from "../../src/features/inbox/model/remoteInbox";
import { existingPath } from "../workspaces/workspace";
import { inspectConversationPath } from "./conversation-file-mutations";

/** Bind approval to checkout-relative paths and the bytes present at approval time. */
export async function captureJiraCommentImages(root: string, paths: unknown) {
  if (!Array.isArray(paths) || !paths.length || paths.length > JIRA_COMMENT_IMAGE_COUNT)
    throw new Error("Provide between one and four Jira comment images.");
  const images = new Map<string, { path: string; sha256: string }>();
  let remaining = JIRA_COMMENT_IMAGE_BYTES;
  for (const supplied of paths) {
    const file = await existingPath(root, supplied);
    const path = relative(root, file).replaceAll("\\", "/");
    if (
      ![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extname(file).toLowerCase()) ||
      /[<>:"|?*]/.test(path) ||
      [...path].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      Buffer.byteLength(basename(file)) > 255
    )
      throw new Error("Use a PNG, JPEG, GIF or WebP file with a valid filename.");
    const info = await lstat(file);
    if (!info.isFile() || info.size < 1 || info.size > remaining)
      throw new Error("Jira comment images must be regular files of up to 10 MiB total.");
    const snapshot = await inspectConversationPath(root, file);
    if (snapshot.kind !== "file" || snapshot.bytes !== info.size)
      throw new Error("Jira comment image changed while it was being checked.");
    if (images.has(path)) throw new Error("Choose distinct Jira comment image paths.");
    remaining -= snapshot.bytes;
    images.set(path, { path, sha256: snapshot.hash });
  }
  return [...images.values()];
}
