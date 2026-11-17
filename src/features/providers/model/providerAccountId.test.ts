import { expect, it } from "vitest";
import { parseProviderAccountId } from "./providerAccountId";
import { PROVIDER_ACCOUNT_PROVIDERS } from "./providerAccounts";

it("accepts an account profile for every provider that has profiles, and none for others", () => {
  for (const provider of PROVIDER_ACCOUNT_PROVIDERS)
    expect(parseProviderAccountId("work-2", provider), provider).toBe("work-2");
  expect(parseProviderAccountId(undefined, "opencode")).toBeUndefined();
  expect(() => parseProviderAccountId("work-2", "opencode")).toThrow("Invalid provider account ID");
  expect(() => parseProviderAccountId("../escape", "grok")).toThrow("Invalid provider account ID");
});
