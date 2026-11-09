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
import { AccountApiError, ApiErrorEnvelope } from "./errors.ts";
import { CONTRACT_HEADER, CONTRACT_VERSION } from "./version.ts";

export interface AccountClientOptions {
  /** API origin, for example `https://api.bycoda.codes`. */
  baseUrl: string;
  /** Returns the current access token, or `null` when signed out. Called per request. */
  getAccessToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
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
  ? []
  : [input: CallInput<R>];

export type AccountClient = {
  [K in JsonRouteName]: (...args: CallArgs<AccountApi[K]>) => Promise<RouteResponse<AccountApi[K]>>;
} & {
  /** Downloads the finished data export file (`GET /v1/me/export/:id/download`). */
  downloadExport: (id: string) => Promise<Blob>;
};

interface UntypedInput {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}

function parseOrThrow(schema: z.ZodType, value: unknown, what: string): unknown {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AccountApiError(400, "validation_failed", `Invalid ${what}: ${result.error.message}`);
}

/**
 * Tiny typed fetch client. Requests and responses are validated with the contract schemas;
 * every failure with a response throws `AccountApiError`. Network failures (no response)
 * propagate as the underlying fetch error so callers can treat them as offline.
 */
export function createAccountClient(options: AccountClientOptions): AccountClient {
  const base = options.baseUrl.replace(/\/+$/, "");

  async function request(definition: RouteDefinition, input: UntypedInput): Promise<Response> {
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

    const init: RequestInit = { method: definition.method, headers };
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
      throw envelope
        ? new AccountApiError(
            response.status,
            envelope.error.code,
            envelope.error.message,
            envelope.error.requestId,
          )
        : new AccountApiError(response.status, "internal", `Request failed (${response.status})`);
    }

    return response;
  }

  async function send(name: JsonRouteName, input: UntypedInput = {}): Promise<unknown> {
    const definition: RouteDefinition = ACCOUNT_API[name];
    const response = await request(definition, input);
    if (!definition.response) return undefined;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new AccountApiError(response.status, "internal", "Response was not valid JSON");
    }
    const parsed = definition.response.safeParse(json);
    if (!parsed.success) {
      throw new AccountApiError(response.status, "internal", "Response did not match the contract");
    }
    return parsed.data;
  }

  const client: Record<string, unknown> = {};
  for (const name of Object.keys(ACCOUNT_API) as RouteName[]) {
    if ((ACCOUNT_API[name] as RouteDefinition).kind === "file") continue;
    client[name] = (input?: UntypedInput) => send(name as JsonRouteName, input);
  }
  client.downloadExport = async (id: string) =>
    (await request(ACCOUNT_API.exportDownload, { params: { id } })).blob();
  return client as AccountClient;
}
