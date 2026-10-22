import { describe, expect, it } from "vitest";
import { duplicateAccountSignIns } from "./providerAccountIdentity";
import type { ProviderAccount } from "./providerAccounts";

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
