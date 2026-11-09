import { AdapterFailure, type AdapterTransport } from "./common";

const MAX_RESPONSE_BYTES = 256 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** HTTPS is required, except for loopback HTTP (a local runtime). Credentials in the URL are refused. */
export function assertEndpointAllowed(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AdapterFailure("not_configured", "The endpoint is not a valid URL.", {
      retryable: false,
    });
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new AdapterFailure(
      "rejected",
      "Only HTTPS endpoints or loopback HTTP endpoints are allowed.",
      {
        retryable: false,
      },
    );
  if (url.username || url.password)
    throw new AdapterFailure("rejected", "Credentials in the endpoint URL are not allowed.", {
      retryable: false,
    });
  return url;
}

/** Maps an HTTP status to a failure. The response body is never read into the message or a log. */
export function statusFailure(status: number): AdapterFailure {
  if (status === 401 || status === 403)
    return new AdapterFailure(
      "auth",
      `The decision source rejected the credentials (HTTP ${status}).`,
      {
        status,
        retryable: false,
      },
    );
  if (status === 429)
    return new AdapterFailure("rate_limited", "The decision source is rate limiting requests.", {
      status,
    });
  if (status === 408 || status >= 500)
    return new AdapterFailure(
      "unavailable",
      `The decision source is unavailable (HTTP ${status}).`,
      {
        status,
      },
    );
  return new AdapterFailure(
    "rejected",
    `The decision source rejected the request (HTTP ${status}).`,
    {
      status,
      retryable: false,
    },
  );
}

async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      throw new AdapterFailure("malformed", "The decision source response is too large.", {
        retryable: false,
      });
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type FetchTransportOptions = {
  fetcher?: typeof fetch;
  runTextPrompt?: AdapterTransport["runTextPrompt"];
};

/**
 * Production transport. Every request carries the caller's signal, which the gateway derives from
 * the request deadline. Redirects are errors, so a credential cannot follow a redirect.
 */
export function createFetchTransport(options: FetchTransportOptions = {}): AdapterTransport {
  const fetcher = options.fetcher ?? fetch;
  return {
    async postJson(url, headers, body, signal) {
      assertEndpointAllowed(url);
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "error",
          signal,
        });
      } catch {
        if (signal.aborted)
          throw new AdapterFailure("timeout", "The decision source did not answer in time.");
        throw new AdapterFailure("unavailable", "The decision source could not be reached.");
      }
      if (!response.ok) throw statusFailure(response.status);
      const text = await readBounded(response, MAX_RESPONSE_BYTES);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AdapterFailure("malformed", "The decision source returned invalid JSON.", {
          retryable: false,
        });
      }
    },
    runTextPrompt:
      options.runTextPrompt ??
      (async () => {
        throw new AdapterFailure("not_configured", "No text prompt runner is configured.", {
          retryable: false,
        });
      }),
  };
}
