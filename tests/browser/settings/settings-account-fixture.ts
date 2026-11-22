import { createMockAccountServer } from "@bycoda/account-contracts/mock";

/** Host name the account controller calls; only this host is answered by the in-memory server. */
const FIXTURE_API = "https://mock.bycoda.invalid";

/**
 * `?account=signedIn`: the Account section as a signed-in person sees it. The native commands report a
 * signed-in session and the contract package's in-memory server answers every account API call, so no
 * network, keychain or real account is reached. Call before the first account read.
 */
export function installSignedInAccountFixture(): void {
  const server = createMockAccountServer();
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input, init) => {
    const request = new Request(input, init);
    return request.url.startsWith(FIXTURE_API)
      ? (server.fetch as typeof fetch)(request)
      : realFetch(input, init);
  }) as typeof fetch;
}

/** Native account commands for the signed-in fixture; undefined for every other command. */
export function signedInAccountCommand(command: string): unknown {
  switch (command) {
    case "account_status":
      return { configured: true, signedIn: true, apiBaseUrl: FIXTURE_API, environment: "staging" };
    case "account_access_token":
      return { accessToken: "mock-desktop-fixture", expiresAt: Date.now() + 3_600_000 };
    case "account_device_info":
      return {
        name: "Fixture computer",
        platform: "windows",
        osVersion: "Windows 11",
        appVersion: "0.0.0-fixture",
        channel: "dev",
      };
    case "account_sign_out":
      return null;
    default:
      return undefined;
  }
}
