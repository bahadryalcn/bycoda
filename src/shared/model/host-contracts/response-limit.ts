/**
 * Largest Host HTTP `/rpc` response body in bytes, measured on the whole body the client reads,
 * including the `{"result":…}` envelope. The desktop (`src-tauri/src/remote/response_limit.rs`,
 * checked against this file by a test) and the phone refuse a larger body, so the Host answers
 * a typed `HOST_RESULT_TOO_LARGE` error instead of sending one.
 */
export const HOST_HTTP_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Error `code` of the Host answer for a result that does not fit one HTTP response. */
export const HOST_RESULT_TOO_LARGE_CODE = "HOST_RESULT_TOO_LARGE";
