// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { providerAccountsStorageRevision } from "./providerAccounts";

beforeEach(() => localStorage.clear());

it("returns the same primitive while storage is unchanged and a new one after a write", () => {
  const empty = providerAccountsStorageRevision();
  expect(providerAccountsStorageRevision()).toBe(empty);
  localStorage.setItem("bycoda.providerAccounts.v2", JSON.stringify({ claude: [] }));
  const written = providerAccountsStorageRevision();
  expect(written).not.toBe(empty);
  expect(providerAccountsStorageRevision()).toBe(written);
  localStorage.removeItem("bycoda.providerAccounts.v2");
  expect(providerAccountsStorageRevision()).toBe(empty);
});
