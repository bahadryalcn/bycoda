// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveProviderAccount } from "../../providers/model/providerAccounts";
import { UsageLimitNotice } from "./UsageLimitNotice";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(invoke)
    .mockReset()
    .mockResolvedValue({
      status: "ok",
      windows: {
        session: { usedPercent: 100, windowMinutes: 300, resetsAt: null },
        weekly: null,
      },
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = (props: Parameters<typeof UsageLimitNotice>[0]) =>
  act(async () => root.render(createElement(UsageLimitNotice, props)));

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
    entry.textContent?.includes(label),
  );

it("offers other accounts of the provider and reports the pick", async () => {
  saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
  const onSwitchAccount = vi.fn();
  await render({
    limit: {},
    provider: "claude",
    accountId: "default",
    onSwitchAccount,
  });

  await act(async () => button("Switch account")!.click());
  const work = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
    (entry) => entry.textContent?.includes("Work"),
  );
  expect(work).toBeDefined();
  await act(async () => work!.click());
  expect(onSwitchAccount).toHaveBeenCalledWith("account-work");
});

it("hides the account action without a second account", async () => {
  await render({
    limit: {},
    provider: "claude",
    accountId: "default",
    onSwitchAccount: vi.fn(),
  });
  expect(button("Switch account")).toBeUndefined();
});

it("asks the composer to open its model picker", async () => {
  const onSwitchModel = vi.fn();
  await render({ limit: {}, onSwitchModel });
  await act(async () => button("Switch model")!.click());
  expect(onSwitchModel).toHaveBeenCalledTimes(1);
});

it("offers supported message recovery when direct resume is unavailable", async () => {
  await render({ limit: { resetsAt: Date.now() - 1000 } });
  expect(button("Resume")).toBeUndefined();
  expect(container.textContent).toContain("Send a message to continue.");
});

it("keeps the local direct resume action operational", async () => {
  const onResume = vi.fn();
  await render({ limit: {}, onResume });
  await act(async () => button("Resume")!.click());
  expect(onResume).toHaveBeenCalledOnce();
});
