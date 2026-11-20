// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference, t } from "../../../shared/i18n";

const reset = vi.hoisted(() => vi.fn(async () => "complete"));
vi.mock("../model/groupLock", () => ({ resetForgottenPassword: reset }));

import { ForgotLockPasswordDialog } from "./ForgotLockPasswordDialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reset.mockClear();
  await setLanguagePreference("tr");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  await setLanguagePreference("en");
});

async function type(value: string) {
  const input = document.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const confirm = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === t("Reset lock"),
  )!;

it("asks for the translated confirmation phrase, not the English one", async () => {
  await act(async () => root.render(createElement(ForgotLockPasswordDialog, { onClose: vi.fn() })));
  const phrase = t("reset lock");
  expect(phrase).not.toBe("reset lock");
  await type("reset lock");
  expect(confirm().disabled).toBe(true);
  await type(phrase);
  expect(confirm().disabled).toBe(false);
});
