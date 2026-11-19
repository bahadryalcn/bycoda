import { z } from "zod";
import {
  ACCOUNT_API,
  buildPath,
  type AccountApi,
  type JsonRouteName,
  type RouteBody,
  type RouteDefinition,
  type RouteName,
  type RouteQuery,
  type RouteResponse,
} from "./api.ts";
import {
  AccountApiError,
  AccountRequestTimeoutError,
  ApiErrorEnvelope,
  type ErrorCode,
} from "./errors.ts";
import { CONTRACT_HEADER, CONTRACT_VERSION } from "./version.ts";

/** Default deadline for one call, covering the request and the response body read. */
export const DEFAULT_ACCOUNT_TIMEOUT_MS = 15_000;
/** Largest delay `setTimeout` accepts; longer values would fire immediately. */
const MAX_TIMER_MS = 2_147_483_647;
const MAX_REPORTED_ISSUES = 5;

export interface AccountClientOptions {
  /** API origin, for example `https://api.bycoda.codes`. */
  baseUrl: string;
  /** Returns the current access token, or `null` when signed out. Called per request. */
  getAccessToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
  /**
   * Deadline per call in milliseconds, covering the request and the body read
   * (default 15 s). `0` or `Infinity` disables it.
   */
  timeoutMs?: number;
}

/** Optional trailing argument of every client call. */
export interface AccountCallOptions {
  /** Aborts the call; the caller's abort reason is rethrown. */
  signal?: AbortSignal;
  /** Replaces the client's deadline for this call. */
  timeoutMs?: number;
}

type ParamsPart<R extends RouteDefinition> = R["path"] extends `${string}:${string}`
  ? { params: Record<string, string> }
  : unknown;
type BodyPart<R extends RouteDefinition> = R extends { body: z.ZodType }
  ? { body: RouteBody<R> }
  : unknown;
type QueryPart<R extends RouteDefinition> = R extends { query: z.ZodType }
  ? { query: RouteQuery<R> }
  : unknown;
export type CallInput<R extends RouteDefinition> = ParamsPart<R> & BodyPart<R> & QueryPart<R>;

type CallArgs<R extends RouteDefinition> = keyof CallInput<R> extends never
  ? [options?: AccountCallOptions]
  : [input: CallInput<R>, options?: AccountCallOptions];

export type AccountClient = {
  [K in JsonRouteName]: (...args: CallArgs<AccountApi[K]>) => Promise<RouteResponse<AccountApi[K]>>;
} & {
  /** Downloads the finished data export file (`GET /v1/me/export/:id/download`). */
  downloadExport: (id: string, options?: AccountCallOptions) => Promise<Blob>;
};

interface UntypedInput {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}

interface IssueSummary {
  path: string;
  code: string;
}

/** Path and code of the first issues; never the offending values. */
function summarizeIssues(error: z.ZodError): IssueSummary[] {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
  }));
}

function parseOrThrow(schema: z.ZodType, value: unknown, what: string): unknown {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new AccountApiError(400, "validation_failed", `Invalid ${what}: ${detail}`, "", {
    cause: summarizeIssues(result.error),
  });
}

/** `Retry-After` as milliseconds: delta-seconds or an HTTP date; `undefined` when absent or unusable. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Gateway statuses that arrive without the error envelope still carry meaning. */
function codeForStatus(status: number): ErrorCode {
  return status === 429 ? "rate_limited" : "internal";
}

interface Deadline {
  signal: AbortSignal;
  /** Settles with `work`, or rejects as soon as the deadline passes or the caller aborts. */
  run: <T>(work: Promise<T>) => Promise<T>;
  dispose: () => void;
}

/**
 * One deadline for a whole call. The race also covers a custom `fetch` or body reader that
 * ignores the signal, so a stalled connection can never leave the call pending.
 */
function startDeadline(timeoutMs: number, external: AbortSignal | undefined): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const limited = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const timer = limited
    ? setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(timeoutMs, MAX_TIMER_MS),
      )
    : undefined;

  const onExternalAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  const aborted = new Promise<never>((_, reject) => {
    const fail = () => {
      if (timedOut) reject(new AccountRequestTimeoutError(timeoutMs));
      else {
        const reason: unknown = controller.signal.reason;
        reject(
          reason ?? Object.assign(new Error("Account request aborted"), { name: "AbortError" }),
        );
      }
    };
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener("abort", fail, { once: true });
  });
  // Rejection is consumed by `run`; this keeps an unused deadline from reporting it as unhandled.
  aborted.catch(() => undefined);

  return {
    signal: controller.signal,
    run: async (work) => {
      try {
        return await Promise.race([work, aborted]);
      } catch (error) {
        // A real fetch rejects with its own AbortError when the timer fires; report the timeout.
        if (timedOut && !(error instanceof AccountApiError)) {
          throw new AccountRequestTimeoutError(timeoutMs);
        }
        throw error;
      }
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/**
 * Tiny typed fetch client. Requests and responses are validated with the contract schemas;
 * every failure with a response throws `AccountApiError`. Network failures (no response)
 * propagate as the underlying fetch error so callers can treat them as offline. A call that
 * outlives its deadline rejects with `AccountRequestTimeoutError`, a `TypeError` that is not
 * an `AccountApiError`, so it takes the same offline path.
 */
export function createAccountClient(options: AccountClientOptions): AccountClient {
  const base = options.baseUrl.replace(/\/+$/, "");

  async function perform<T>(
    definition: RouteDefinition,
    input: UntypedInput,
    signal: AbortSignal,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const headers: Record<string, string> = { [CONTRACT_HEADER]: CONTRACT_VERSION };
    if (definition.auth === "user") {
      const token = await options.getAccessToken();
      if (!token) throw new AccountApiError(401, "unauthorized", "Not signed in");
      headers.Authorization = `Bearer ${token}`;
    }

    let url = base + buildPath(definition, input.params);
    if (definition.query) {
      parseOrThrow(definition.query, input.query ?? {}, "query");
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(input.query ?? {})) {
        if (value !== undefined) search.set(key, String(value));
      }
      const text = search.toString();
      if (text) url += `?${text}`;
    }

    const init: RequestInit = { method: definition.method, headers, signal };
    if (definition.body) {
      init.body = JSON.stringify(parseOrThrow(definition.body, input.body, "request body"));
      headers["Content-Type"] = "application/json";
    }

    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await doFetch(url, init);

    if (!response.ok) {
      let envelope: ApiErrorEnvelope | null = null;
      try {
        const parsed = ApiErrorEnvelope.safeParse(await response.json());
        envelope = parsed.success ? parsed.data : null;
      } catch {
        envelope = null;
      }
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const extra = retryAfterMs === undefined ? {} : { retryAfterMs };
      throw envelope
        ? new AccountApiError(
            response.status,
            envelope.error.code,
            envelope.error.message,
            envelope.error.requestId,
            extra,
          )
        : new AccountApiError(
            response.status,
            codeForStatus(response.status),
            `Request failed (${response.status})`,
            "",
            extra,
          );
    }

    return read(response);
  }

  /** Runs one call under a single deadline that also covers reading the body. */
  async function execute<T>(
    definition: RouteDefinition,
    input: UntypedInput,
    call: AccountCallOptions | undefined,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const deadline = startDeadline(
      call?.timeoutMs ?? options.timeoutMs ?? DEFAULT_ACCOUNT_TIMEOUT_MS,
      call?.signal,
    );
    try {
      return await deadline.run(perform(definition, input, deadline.signal, read));
    } finally {
      deadline.dispose();
    }
  }

  async function readContract(definition: RouteDefinition, response: Response): Promise<unknown> {
    if (!definition.response) return undefined;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new AccountApiError(response.status, "internal", "Response was not valid JSON");
    }
    const parsed = definition.response.safeParse(json);
    if (!parsed.success) {
      const [first] = summarizeIssues(parsed.error);
      throw new AccountApiError(
        response.status,
        "internal",
        `Response did not match the contract at ${first?.path ?? "(root)"} (${first?.code ?? "invalid"})`,
        "",
        { cause: summarizeIssues(parsed.error) },
      );
    }
    return parsed.data;
  }

  function takesInput(definition: RouteDefinition): boolean {
    return definition.path.includes(":") || Boolean(definition.body) || Boolean(definition.query);
  }

  const client: Record<string, unknown> = {};
  for (const name of Object.keys(ACCOUNT_API) as RouteName[]) {
    const definition: RouteDefinition = ACCOUNT_API[name];
    if (definition.kind === "file") continue;
    const hasInput = takesInput(definition);
    client[name] = (...args: unknown[]) => {
      const input = (hasInput ? args[0] : undefined) as UntypedInput | undefined;
      const call = (hasInput ? args[1] : args[0]) as AccountCallOptions | undefined;
      return execute(definition, input ?? {}, call, (response) =>
        readContract(definition, response),
      );
    };
  }
  client.downloadExport = (id: string, call?: AccountCallOptions) =>
    execute(ACCOUNT_API.exportDownload, { params: { id } }, call, (response) => response.blob());
  return client as AccountClient;
}
