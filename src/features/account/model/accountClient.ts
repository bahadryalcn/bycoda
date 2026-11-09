import { createAccountClient, type AccountClient } from "@bycoda/account-contracts";

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
};

/** The contract client with the device header; the base fetch is the webview's unless replaced. */
export function createAccountApi(options: AccountApiOptions): AccountClient {
  const base = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return createAccountClient({
    baseUrl: options.baseUrl,
    getAccessToken: options.getAccessToken,
    fetch: withDeviceHeader(base, options.getDeviceId),
  });
}

/** `VITE_BYCODA_ACCOUNT_MOCK=1` runs the account against the in-memory contract server. */
export function isAccountMockMode(): boolean {
  return import.meta.env?.VITE_BYCODA_ACCOUNT_MOCK === "1";
}
