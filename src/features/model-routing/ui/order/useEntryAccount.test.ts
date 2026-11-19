// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  renameProviderAccount,
  saveProviderAccount,
} from "../../../providers/model/providerAccounts";
import { useEntryAccount, type EntryAccount } from "./useEntryAccount";

/**
 * Regression for #1230: each order row used to JSON.parse a fresh copy of the provider
 * accounts on every render. Rows now read the shared store snapshot, so the account list keeps
 * its identity while nothing changed and the selected account still follows store writes.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Entry = Parameters<typeof useEntryAccount>[0];

let root: Root;
let container: HTMLElement;
let renders: EntryAccount[];

function Probe({ entry }: { entry: Entry }) {
  renders.push(useEntryAccount(entry));
  return null;
}

const render = (entry: Entry) => act(() => root.render(createElement(Probe, { entry })));

beforeEach(() => {
  localStorage.clear();
  renders = [];
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

it("keeps the account list identity across unrelated store notifications", () => {
  act(() => void saveProviderAccount({ id: "account-a", provider: "claude", label: "A" }));
  render({ harness: "claude", providerAccountId: "account-a" });
  const first = renders.at(-1)!;
  expect(first.account?.label).toBe("A");

  act(() => void window.dispatchEvent(new Event("bycoda-provider-accounts-changed")));
  render({ harness: "claude", providerAccountId: "account-a" });
  expect(renders.at(-1)!.accounts).toBe(first.accounts);
});

it("follows store writes to the selected account", () => {
  act(() => void saveProviderAccount({ id: "account-a", provider: "claude", label: "A" }));
  render({ harness: "claude", providerAccountId: "account-a" });

  act(() => renameProviderAccount("claude", "account-a", "Alpha"));
  expect(renders.at(-1)!.account?.label).toBe("Alpha");
  expect(renders.at(-1)!.accounts.find((account) => account.id === "account-a")?.label).toBe(
    "Alpha",
  );
});

it("returns no account for shared harnesses", () => {
  render({ harness: "opencode" as Entry["harness"] });
  expect(renders.at(-1)!.supported).toBe(false);
  expect(renders.at(-1)!.accounts).toEqual([]);
  expect(renders.at(-1)!.account).toBeUndefined();
});
