// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { saveProviderAccount } from "../../providers/model/providerAccounts";
import {
  accountSessionDefaults,
  saveGlobalSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import { accountScopeRowProps, defaultsAccounts } from "./providerDefaultsScope";
import { decodeAdvisor, decodeSubagents } from "../../../shared/model/host-contracts/delegation";

const persist = (write: () => void, verify: () => boolean) => {
  write();
  expect(verify()).toBe(true);
};

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

it("edits one account's overrides and inherits the provider's global defaults", () => {
  saveGlobalSessionDefaults("claude", { effort: "low" });
  const input = { harness: "claude" as const, accountId: "account-home", globalModel: "opus" };
  let props = accountScopeRowProps({ ...input, persist });
  expect(props.inheritedDefaults).toMatchObject({ effort: "low" });
  expect(props.selectedModel).toBe("opus");
  props.onModelChange("claude", "sonnet");
  props = accountScopeRowProps({ ...input, persist });
  props.onSessionDefaultsChange({ effort: "high" });
  expect(accountSessionDefaults("claude", "account-home")).toEqual({
    effort: "high",
    model: "sonnet",
  });
  accountScopeRowProps({ ...input, persist }).onModelReset();
  expect(accountSessionDefaults("claude", "account-home")).toEqual({ effort: "high" });
  expect(accountSessionDefaults("claude", "account-work")).toEqual({});
});

it("shows unsaved product defaults bound to each account without saving overrides", () => {
  for (const accountId of ["account-home", "account-work"]) {
    const props = accountScopeRowProps({
      harness: "claude",
      accountId,
      globalModel: "opus",
      persist,
    });
    expect(decodeAdvisor(props.inheritedDefaults.extras?.crossAdvisor)?.providerAccountId).toBe(
      accountId,
    );
    expect(
      decodeSubagents(props.inheritedDefaults.extras?.crossSubagents)[0]?.providerAccountId,
    ).toBe(accountId);
    expect(props.scopeDefaults).toEqual({});
    expect(accountSessionDefaults("claude", accountId)).toEqual({});
  }
});
