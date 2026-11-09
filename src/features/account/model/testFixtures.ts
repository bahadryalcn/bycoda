import type { AccountContext } from "@bycoda/account-contracts";

export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

export const ACCOUNT_CONTEXT: AccountContext = {
  user: {
    id: "usr_1",
    email: "ada@example.com",
    displayName: "Ada",
    avatarUrl: null,
    locale: "en",
    timeZone: "Europe/Istanbul",
    createdAt: "2026-11-08T10:00:00.000Z",
    signInMethods: ["google"],
    deletion: null,
  },
  entitlements: { planTier: "individual", features: {} },
  organizations: [],
};
