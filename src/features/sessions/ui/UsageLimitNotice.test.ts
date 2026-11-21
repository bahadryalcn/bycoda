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
      unobserve() {}
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

it("keeps model selection and account selection separate", async () => {
  saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
  const onSwitchModel = vi.fn();
  const onSwitchAccount = vi.fn();
  const onDismiss = vi.fn();
  await render({ limit: {}, provider: "claude", onSwitchModel, onSwitchAccount, onDismiss });

  await act(async () => button("Switch model")!.click());
  expect(onSwitchModel).toHaveBeenCalledOnce();
  expect(onSwitchAccount).not.toHaveBeenCalled();
  await act(async () => button("Switch account")!.click());
  const work = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
    (entry) => entry.textContent?.includes("Work"),
  );
  await act(async () => work!.click());
  expect(onSwitchAccount).toHaveBeenCalledWith("account-work");
  expect(onSwitchModel).toHaveBeenCalledOnce();

  const dismiss = container.querySelector<HTMLButtonElement>(
    '[aria-label="Dismiss usage limit notice"]',
  );
  await act(async () => dismiss!.click());
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("offers Continue on the new target even when the old limit has not reset", async () => {
  const onResume = vi.fn();
  const onResumeAtReset = vi.fn();
  const limit = { resetsAt: Date.now() + 3_600_000, resumeAtReset: true };
  await render({ limit, onResume, onResumeAtReset });
  expect(button("Continue")).toBeUndefined();
  await render({
    limit: { ...limit, recoveryFrom: { harness: "claude", model: "claude:sonnet-5" } },
    onResume,
    onResumeAtReset,
  });
  expect(button("Cancel auto-resume")).toBeUndefined();
  expect(onResume).not.toHaveBeenCalled();
  await act(async () => button("Continue")!.click());
  expect(onResume).toHaveBeenCalledOnce();
});

it("offers supported message recovery when direct resume is unavailable", async () => {
  await render({ limit: { resetsAt: Date.now() - 1000 } });
  // The minute clock trails the reset; the zero-delay deadline timer records the reset itself.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(button("Resume")).toBeUndefined();
  expect(container.textContent).toContain("Send a message to continue.");
});

it("keeps the local direct resume action operational", async () => {
  const onResume = vi.fn();
  await render({ limit: {}, onResume });
  await act(async () => button("Try again")!.click());
  expect(onResume).toHaveBeenCalledOnce();
});

it("says an unknown reset is unknown and never offers to arm it", async () => {
  await render({ limit: {}, onResume: vi.fn(), onResumeAtReset: vi.fn() });
  expect(container.textContent).toContain("Reset time unknown");
  expect(button("Resume at reset")).toBeUndefined();
});

it("names the auto-resume toggle by the action it performs", async () => {
  const onResumeAtReset = vi.fn();
  const resetsAt = Date.now() + 3_600_000;
  await render({ limit: { resetsAt }, onResumeAtReset });
  await act(async () => button("Resume at reset")!.click());
  expect(onResumeAtReset).toHaveBeenLastCalledWith(true);

  await render({ limit: { resetsAt, resumeAtReset: true }, onResumeAtReset });
  expect(button("Resume at reset")).toBeUndefined();
  await act(async () => button("Cancel auto-resume")!.click());
  expect(onResumeAtReset).toHaveBeenLastCalledWith(false);
});
