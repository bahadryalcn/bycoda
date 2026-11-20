import {
  HOST_HTTP_MAX_RESPONSE_BYTES,
  HOST_RESULT_TOO_LARGE_CODE,
} from "../../src/shared/model/host-contracts/response-limit";

/**
 * The finished `/rpc` body does not fit one HTTP response. The handler already ran, so an
 * effectful method's outcome is unknown to the caller, which recovers through the command
 * receipt the Host kept; a query has nothing to recover. Nothing larger is ever written.
 */
export class HostResultTooLargeError extends Error {
  readonly code = HOST_RESULT_TOO_LARGE_CODE;
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
    readonly effect: boolean,
  ) {
    super(
      `Result too large to send (${bytes} of ${maxBytes} bytes); narrow the request or read it in pages.`,
    );
    this.name = "HostResultTooLargeError";
  }
}

/**
 * Checks the complete response body, envelope included, against the client limit before any byte
 * is written. UTF-8 uses at most 3 bytes per UTF-16 unit, so small bodies skip the exact count.
 */
export function assertResponseFits(
  body: string,
  effect: boolean,
  maxBytes = HOST_HTTP_MAX_RESPONSE_BYTES,
): void {
  if (body.length * 3 <= maxBytes) return;
  const bytes = Buffer.byteLength(body);
  if (bytes > maxBytes) throw new HostResultTooLargeError(bytes, maxBytes, effect);
}
