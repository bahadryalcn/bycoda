import type { DecisionSource } from "./decision-types";

/**
 * Small, harmless probes used by discovery and manual endpoint checks. They do not depend on the
 * 4F-1 adapters: the request shape is the Host's own DecisionRequest, and a System One answer is
 * recognized by an `answers` object that contains the probe question.
 * shortcut: the response shape is inferred from the decision contract, not from a recorded live
 * System One endpoint; live verification is still unverified.
 */

export const SYSTEMONE_PATHS = ["/v1/systemone", "/api/systemone", "/v1/decisions"] as const;

export const SYSTEMONE_PROBE_BODY = {
  taskType: "generic",
  personalData: false,
  state: { probe: "contract" },
  questions: {
    probe: {
      type: "noul",
      instructions: "Answer true.",
      criteria: { true: "true", false: "false" },
    },
  },
} as const;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const MAX_PROBE_BODY_BYTES = 64 * 1024;

/** Automatic scanning may only touch loopback addresses over plain http. */
export function assertLoopback(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname))
    throw new Error("Automatic discovery only probes loopback addresses.");
}

export function adapterForPath(pathname: string): DecisionSource["adapter"] {
  if (pathname.endsWith("/v1/systemone")) return "systemone";
  if (pathname.endsWith("/api/systemone")) return "ollama-systemone";
  if (pathname.endsWith("/v1/decisions")) return "decisions";
  return "custom";
}

export function isSystemOneShape(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const answers = (body as { answers?: unknown }).answers;
  return !!answers && typeof answers === "object" && !Array.isArray(answers) && "probe" in answers;
}

export type ProbeResponse = { status: number; body?: unknown };

/** One request with a deadline. Redirects are refused and the body is capped. Undefined on failure. */
export async function probeRequest(
  url: string,
  options: {
    method: "GET" | "POST";
    timeoutMs: number;
    signal?: AbortSignal;
    fetchImpl: typeof fetch;
    body?: unknown;
  },
): Promise<ProbeResponse | undefined> {
  try {
    const response = await options.fetchImpl(url, {
      method: options.method,
      redirect: "error",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
        : AbortSignal.timeout(options.timeoutMs),
    });
    const text = await readCapped(response, MAX_PROBE_BODY_BYTES);
    return { status: response.status, body: parseJson(text) };
  } catch {
    return undefined;
  }
}

/** Sends the System One probe to one exact URL. `systemone` is true only for the recognized shape. */
export async function probeSystemOne(
  url: string,
  options: { fetchImpl: typeof fetch; signal?: AbortSignal; timeoutMs: number },
): Promise<{ reachable: boolean; systemone: boolean; status?: number }> {
  const response = await probeRequest(url, {
    method: "POST",
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    body: SYSTEMONE_PROBE_BODY,
  });
  if (!response) return { reachable: false, systemone: false };
  return {
    reachable: true,
    systemone: response.status < 500 && isSystemOneShape(response.body),
    status: response.status,
  };
}

async function readCapped(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) return "";
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
