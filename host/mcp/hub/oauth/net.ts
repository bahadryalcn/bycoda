/** Bounded HTTP for OAuth discovery and token calls: deadline, size cap, no unsafe redirects. */
export const OAUTH_FETCH_DEADLINE_MS = 10_000;
export const OAUTH_MAX_BODY_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

export type OAuthFetch = typeof fetch;
export type OAuthResponse = { status: number; headers: Headers; text: string };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** https everywhere, plain http only on loopback; no embedded credentials or fragments. */
export function safeUrl(raw: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new Error("Invalid sign-in URL.");
  }
  const loopbackHttp = url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if ((url.protocol !== "https:" && !loopbackHttp) || url.username || url.password || url.hash)
    throw new Error("Sign-in URL is not allowed.");
  return url;
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OAUTH_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Sign-in response too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One logical request: the deadline covers redirects and the body. Only GET follows redirects. */
export async function oauthFetch(
  doFetch: OAuthFetch,
  target: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  deadlineMs = OAUTH_FETCH_DEADLINE_MS,
): Promise<OAuthResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    let url = safeUrl(target);
    for (let hop = 0; ; hop++) {
      const response = await doFetch(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        if ((init.method ?? "GET") !== "GET" || hop >= MAX_REDIRECTS)
          throw new Error("Sign-in request was redirected.");
        url = safeUrl(location, url.href);
        continue;
      }
      return {
        status: response.status,
        headers: response.headers,
        text: await readCapped(response),
      };
    }
  } catch (error) {
    // Upstream text can echo request data, so only fixed messages leave this layer.
    if (error instanceof Error && /^(Sign-in|Invalid sign-in)/.test(error.message)) throw error;
    throw new Error(
      controller.signal.aborted ? "Sign-in request timed out." : "Sign-in request failed.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // falls through to the fixed error
  }
  throw new Error("Sign-in response was not understood.");
}
