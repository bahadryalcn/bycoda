import {
  createAccountClient,
  DEFAULT_ACCOUNT_TIMEOUT_MS,
  type AccountClient,
} from "@bycoda/account-contracts";

/** Tells the service which registered device a request comes from. */
export const DEVICE_HEADER = "X-Bycoda-Device";

/** Adds the device header to every request once this computer has a registered device id. */
export function withDeviceHeader(
  base: typeof fetch,
  getDeviceId: () => string | null,
): typeof fetch {
  return (input, init) => {
    const deviceId = getDeviceId();
    if (!deviceId) return base(input, init);
    return base(input, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        [DEVICE_HEADER]: deviceId,
      },
    });
  };
}

export type AccountApiOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  getDeviceId: () => string | null;
  fetchImpl?: typeof fetch;
  /** Deadline per call; defaults to the contract's 15 s. A call may pass its own `timeoutMs`/`signal`. */
  timeoutMs?: number;
};

/**
 * The contract client with the device header; the base fetch is the webview's unless replaced.
 * Every call runs under one deadline covering the request and the body read, so a stalled
 * connection rejects with a network-class error (`AccountRequestTimeoutError`) that callers
 * and `handleFailure` already treat as offline. Callers never retry mutations on a timeout:
 * the server may have applied them.
 */
export function createAccountApi(options: AccountApiOptions): AccountClient {
  const base = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return createAccountClient({
    baseUrl: options.baseUrl,
    getAccessToken: options.getAccessToken,
    fetch: withDeviceHeader(base, options.getDeviceId),
    timeoutMs: options.timeoutMs ?? DEFAULT_ACCOUNT_TIMEOUT_MS,
  });
}

/** `VITE_BYCODA_ACCOUNT_MOCK=1` runs the account against the in-memory contract server. */
export function isAccountMockMode(): boolean {
  return import.meta.env?.VITE_BYCODA_ACCOUNT_MOCK === "1";
}
