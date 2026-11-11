// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  removeProviderAccount,
  renameProviderAccount,
  saveProviderAccount,
  saveTerminalProviderAccount,
  setDefaultProviderAccount,
  setProviderAccountColor,
  type ProviderAccount,
} from "./providerAccounts";
import { useProviderAccounts } from "./useProviderAccounts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let renders: ProviderAccount[][];

function Probe() {
  renders.push(useProviderAccounts("claude"));
  return null;
}

beforeEach(() => {
  localStorage.clear();
  renders = [];
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

const labels = () => renders.at(-1)!.map((account) => account.label);

it("re-renders for every writer and keeps the snapshot while nothing changed", () => {
  act(() => root.render(createElement(Probe)));
  const first = renders.at(-1)!;
  expect(labels()).toEqual(["Default account"]);

  // An unrelated notification must not produce a new snapshot identity.
  act(() => void window.dispatchEvent(new Event("bycoda-provider-accounts-changed")));
  expect(renders.at(-1)).toBe(first);

  act(() => saveProviderAccount({ id: "account-a", provider: "claude", label: "A" }));
  expect(labels()).toContain("A");
  act(() => renameProviderAccount("claude", "account-a", "Alpha"));
  expect(labels()).toContain("Alpha");
  act(() => saveTerminalProviderAccount({ id: "terminal-b", provider: "claude", label: "B" }));
  expect(labels()).toContain("B");
  act(() => setProviderAccountColor("claude", "account-a", "teal"));
  expect(renders.at(-1)!.find((account) => account.id === "account-a")?.color).toBe("teal");
  act(() => setDefaultProviderAccount("claude", "account-a"));
  expect(renders.at(-1)!.find((account) => account.isDefault)?.id).toBe("account-a");
  act(() => void removeProviderAccount("claude", "terminal-b"));
  expect(labels()).not.toContain("B");

  const stable = renders.at(-1)!;
  act(() => void window.dispatchEvent(new Event("bycoda-provider-accounts-changed")));
  expect(renders.at(-1)).toBe(stable);
});
