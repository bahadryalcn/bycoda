import { z } from "zod";

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "two_factor_required",
  "ip_not_allowed",
  "not_found",
  "validation_failed",
  "rate_limited",
  "conflict",
  "device_revoked",
  "account_pending_deletion",
  "account_deactivated",
  "contract_version_unsupported",
  "internal",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every non-2xx response body. `requestId` is quotable in support tickets. */
export const ApiErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

export interface AccountApiErrorOptions {
  /** Server-requested back-off from `Retry-After`, in milliseconds. */
  retryAfterMs?: number;
  /** Diagnostic detail (never response values or tokens). */
  cause?: unknown;
}

export class AccountApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string;
  readonly retryAfterMs?: number;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    requestId = "",
    options: AccountApiErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * A request or its body read exceeded the client deadline. It extends `TypeError` like a
 * failed `fetch` and is not an `AccountApiError`, so existing offline handling covers it.
 */
export class AccountRequestTimeoutError extends TypeError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Account request timed out after ${timeoutMs} ms`);
    this.name = "AccountRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
