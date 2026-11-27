// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { saveProviderAccount } from "../../providers/model/providerAccounts";
import {
  accountSessionDefaults,
  globalProviderSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import { defaultsAccounts } from "./providerDefaultsScope";
import { decodeAdvisor } from "../../../shared/model/host-contracts/delegation";

beforeEach(() => {
  localStorage.clear();
  saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
  saveProviderAccount({ id: "account-home", provider: "claude", label: "Home" });
});

it("offers account scope only for providers with several accounts", () => {
  expect(defaultsAccounts("claude").map((account) => account.id)).toEqual([
    "default",
    "account-work",
    "account-home",
  ]);
  expect(defaultsAccounts("grok")).toEqual([]);
});

it("shows unsaved product defaults bound to each account without saving overrides", () => {
  for (const accountId of ["account-home", "account-work"]) {
    const inherited = globalProviderSessionDefaults("claude", accountId);
    expect(decodeAdvisor(inherited.extras?.crossAdvisor)?.providerAccountId).toBe(accountId);
    expect(inherited.extras?.crossSubagents).toBe("auto");
    expect(accountSessionDefaults("claude", accountId)).toEqual({});
  }
});
