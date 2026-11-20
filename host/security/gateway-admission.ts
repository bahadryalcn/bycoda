import { WS_LIMITS } from "../../src/shared/model/host-contracts";

/**
 * Admission for the phone-facing gateways (LAN and TLS). Sockets up to `maxAdmitted` are
 * served. The next `rejectReserve` sockets are answered with 429 + Retry-After, so the
 * client backs off instead of treating a reset as a lost link. Anything beyond that is
 * destroyed without a response, as before. The hard ceiling is the sum of both.
 */
export const GATEWAY_ADMISSION = Object.freeze({
  maxAdmitted: WS_LIMITS.maxAuthenticatedSockets,
  // shortcut: fixed reserve for 429 answers, upgrade to a Host-owned limit if phones need more headroom
  rejectReserve: 8,
});

export const OVER_CAPACITY_RETRY_AFTER_SECONDS = 1;

export const OVER_CAPACITY_HTTP_RESPONSE = `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${OVER_CAPACITY_RETRY_AFTER_SECONDS}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
