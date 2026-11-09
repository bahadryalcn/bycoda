import { createMockAccountServer } from "@bycoda/account-contracts/mock";
import { AccountNativeError, type AccountNative } from "./accountNative";

/** Mock tokens are accepted by the in-memory server (`mock-*`). */
const MOCK_TOKEN = "mock-desktop-dev";
const MOCK_BASE_URL = "https://mock.bycoda.invalid";

/**
 * Development without a backend: a fake sign-in that finishes at once and the contract's
 * in-memory server as the fetch implementation. Never used unless `VITE_BYCODA_ACCOUNT_MOCK=1`.
 */
export function createMockAccountRuntime(): {
  native: AccountNative;
  fetchImpl: typeof fetch;
} {
  const server = createMockAccountServer();
  let signedIn = false;
  const native: AccountNative = {
    status: async () => ({
      configured: true,
      signedIn,
      apiBaseUrl: MOCK_BASE_URL,
      environment: "staging",
    }),
    signInStart: async () => {
      signedIn = true;
      return { handle: "mock", authorizeUrl: `${MOCK_BASE_URL}/sign-in`, expiresIn: 300 };
    },
    signInPoll: async () => ({ status: "done" }),
    signInCancel: async () => {
      signedIn = false;
    },
    accessToken: async () => {
      if (!signedIn) throw new AccountNativeError("signedOut", "Signed out.");
      return { accessToken: MOCK_TOKEN, expiresAt: Date.now() + 3_600_000 };
    },
    signOut: async () => {
      signedIn = false;
    },
    deviceInfo: async () => ({
      name: "Dev computer",
      platform: "windows",
      osVersion: "Windows 11",
      appVersion: "0.0.0-dev",
      channel: "dev",
    }),
  };
  return { native, fetchImpl: server.fetch as typeof fetch };
}
