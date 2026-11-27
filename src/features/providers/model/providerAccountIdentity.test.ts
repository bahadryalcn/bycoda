// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { duplicateAccountSignIns, refreshProviderAccountIdentity } from "./providerAccountIdentity";
import {
  editProviderAccount,
  providerAccounts,
  saveProviderAccount,
  type ProviderAccount,
} from "./providerAccounts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

const account = (id: string, label = id): ProviderAccount => ({
  id,
  provider: "claude",
  label,
});

describe("duplicateAccountSignIns", () => {
  it("flags only the later account with the same email", () => {
    const accounts = [account("a"), account("b"), account("c")];
    const duplicates = duplicateAccountSignIns(accounts, {
      "claude:a": { email: "Me@Example.com" },
      "claude:b": { email: "me@example.com" },
      "claude:c": { email: "other@example.com" },
    });
    expect(Object.keys(duplicates)).toEqual(["claude:b"]);
    expect(duplicates["claude:b"]?.id).toBe("a");
  });

  it("keeps different organizations of one email apart and ignores signed-out profiles", () => {
    const accounts = [account("a"), account("b"), account("c"), account("d")];
    expect(
      duplicateAccountSignIns(accounts, {
        "claude:a": { email: "me@example.com", organization: "Acme" },
        "claude:b": { email: "me@example.com", organization: "Other" },
        "claude:c": null,
        "claude:d": {},
      }),
    ).toEqual({});
  });
});

it.each([
  ["claude", " Team ", "work"],
  ["codex", "Team", "work"],
  ["codex", "Business", "work"],
  ["claude", "Max", undefined],
  ["grok", null, undefined],
  ["grok", "Team", undefined],
] as const)(
  "assigns a legacy %s %s account only from a supported plan",
  async (provider, plan, kind) => {
    const profile = { id: "account-legacy", provider, label: "Work office" };
    saveProviderAccount(profile);
    vi.mocked(invoke).mockResolvedValue({ plan, organization: "Work office" });
    await refreshProviderAccountIdentity(provider, profile.id);
    expect(providerAccounts(provider).find((entry) => entry.id === profile.id)?.kind).toBe(kind);
  },
);

it("keeps an explicit Personal choice made while a Team lookup is pending", async () => {
  let resolve!: (identity: { plan: string }) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const read = refreshProviderAccountIdentity("claude", "default");
  editProviderAccount("claude", "default", { label: "Family", kind: "personal" });
  resolve({ plan: "Team" });
  await read;
  expect(providerAccounts("claude")[0]).toMatchObject({ label: "Family", kind: "personal" });
});
