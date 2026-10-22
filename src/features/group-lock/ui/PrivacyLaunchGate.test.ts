// @vitest-environment happy-dom
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { getGroupLockView, setLockPassword, setStartInPrivacyMode } from "../model/groupLock";
import { PrivacyLaunchGate } from "./PrivacyLaunchGate";

let container: HTMLDivElement;
let root: Root;
const mounted = vi.fn();
function Workspace() {
  useEffect(() => {
    mounted();
  }, []);
  return createElement("div", null, "Private project and draft");
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  await setLanguagePreference("en");
  mounted.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = () =>
  act(() =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(PrivacyLaunchGate, null, createElement(Workspace)),
      ),
    ),
  );
const click = (text: string) =>
  act(() => {
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === text)!
      .click();
  });

it("opens normally by default and applies a preference change only on the next launch", () => {
  render();
  expect(container.textContent).toContain("Private project and draft");
  act(() => setStartInPrivacyMode(true));
  expect(container.textContent).toContain("Private project and draft");
  expect(JSON.parse(localStorage.getItem("bycoda.groupLock")!).startInPrivacyMode).toBe(true);
  act(() => root.unmount());
  root = createRoot(container);
  mounted.mockClear();
  render();
  expect(mounted).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Private project and draft");
});

it("never mounts private children until continuing, then keeps the next-launch preference", () => {
  setStartInPrivacyMode(true);
  render();
  expect(mounted).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Privacy mode");
  click("Show workspace");
  expect(container.textContent).toContain("Private project and draft");
  expect(getGroupLockView().settings.startInPrivacyMode).toBe(true);
});

it("cancel and Escape keep the workspace concealed; another window cannot disable the current screen", async () => {
  await setLockPassword("correct-password");
  setStartInPrivacyMode(true);
  render();
  click("Show workspace");
  click("Cancel");
  expect(mounted).not.toHaveBeenCalled();
  click("Show workspace");
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(mounted).not.toHaveBeenCalled();
  act(() => setStartInPrivacyMode(false));
  expect(container.textContent).toContain("Privacy mode");
});

it("rejects a wrong password in StrictMode and reveals children after the correct password", async () => {
  await setLockPassword("correct-password");
  setStartInPrivacyMode(true);
  render();
  click("Show workspace");
  // Key derivation is deliberately slow and slower still on shared CI runners.
  const submit = async (password: string, settled: () => boolean) => {
    const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    input.value = password;
    await act(async () => {
      input
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(
      async () => {
        await act(async () => {});
        if (!settled()) throw new Error("Password check has not settled");
      },
      { timeout: 15_000, interval: 50 },
    );
  };
  await submit(
    "incorrect-password",
    () => !!document.body.textContent?.includes("Wrong password."),
  );
  expect(mounted).not.toHaveBeenCalled();
  await submit(
    "correct-password",
    () => !!container.textContent?.includes("Private project and draft"),
  );
  expect(mounted).toHaveBeenCalled();
}, 40_000);

it("keeps recovery cancellation private and allows continuing after explicit password reset", async () => {
  await setLockPassword("correct-password");
  setStartInPrivacyMode(true);
  render();
  click("Forgot the password?");
  click("Cancel");
  expect(mounted).not.toHaveBeenCalled();
  click("Forgot the password?");
  const input = document.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "reset lock");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  click("Reset lock");
  expect(mounted).not.toHaveBeenCalled();
  expect(getGroupLockView().hasPassword).toBe(false);
  click("Show workspace");
  expect(container.textContent).toContain("Private project and draft");
});
