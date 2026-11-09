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

export class AccountApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string;

  constructor(status: number, code: ErrorCode, message: string, requestId = "") {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
