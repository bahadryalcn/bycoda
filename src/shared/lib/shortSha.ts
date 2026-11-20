/** Length of an inline commit id: Git's default abbreviation, shared by every workspace and Git surface. */
export const SHORT_SHA_LENGTH = 7;

/**
 * Abbreviates a full commit id for display only. Copy, links, Git commands, caches and
 * protocol messages keep the full id.
 */
export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}
