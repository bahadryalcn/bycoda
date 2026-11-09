import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { sanitizeSocialError } from "../core/social-helpers";

export const EMAIL_HTTP_TIMEOUT_MS = 20_000;

/**
 * Maps a non-2xx provider answer to a platform error. The body is logged sanitized and truncated
 * (it can echo recipient data), and is never placed in the thrown error.
 */
export async function providerFailure(
  provider: string,
  response: Response,
): Promise<SocialPlatformError> {
  const body = await response.text().catch(() => "");
  console.error(
    `Social email ${provider} request failed with HTTP ${response.status}:`,
    sanitizeSocialError(body),
  );
  if (response.status === 401 || response.status === 403) return new SocialPlatformError("expired");
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return new SocialPlatformError(
      "rate_limit",
      Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : undefined,
    );
  }
  if (response.status >= 400 && response.status < 500) return new SocialPlatformError("rejected");
  // 5xx: the provider may have accepted the message, so the caller must not resend.
  return new SocialPlatformError("unknown");
}
