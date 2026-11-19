/** A refresh failure the host may act on. `permanent` means the provider rejected the grant itself
 * (revoked or invalid), so retrying cannot succeed until the owner reconnects. Everything else,
 * including unclassified errors, is transient and retried with backoff. The message is a fixed
 * string: never place a provider response body, token or code in it. */
export class SocialRefreshError extends Error {
  constructor(
    readonly kind: "permanent" | "transient",
    message: string,
  ) {
    super(message);
    this.name = "SocialRefreshError";
  }
}

export function isPermanentRefreshFailure(error: unknown): boolean {
  return error instanceof SocialRefreshError && error.kind === "permanent";
}
