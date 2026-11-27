import { expect, it } from "vitest";
import { accountDisplayLabel } from "./providerAccounts";

const id = "account-ee4f0373-d06c-406a-9eb3-135f622ab501";
const accounts = [
  { id: "default", provider: "claude" as const },
  { id, provider: "claude" as const },
  { id: "account-other", provider: "codex" as const },
];

it("keeps a real name", () => {
  expect(accountDisplayLabel({ id, provider: "claude", label: "Work" }, accounts)).toBe("Work");
});

it("never shows the generated id: email first, else the provider ordinal", () => {
  const account = { id, provider: "claude" as const, label: id };
  expect(accountDisplayLabel(account, accounts, " me@example.com ")).toBe("me@example.com");
  expect(accountDisplayLabel(account, accounts)).toBe("Account 2");
  expect(accountDisplayLabel({ ...account, label: "" }, accounts)).toBe("Account 2");
  expect(
    accountDisplayLabel(
      { ...account, label: "account-12345678-1234-1234-1234-123456789abc" },
      accounts,
    ),
  ).toBe("Account 2");
});

it("translates the default account label", () => {
  expect(
    accountDisplayLabel({ id: "default", provider: "claude", label: "Default account" }, accounts),
  ).toBe("Default account");
});
