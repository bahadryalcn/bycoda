// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetLockPasswordDialog } from "./SetLockPasswordDialog";
import { PasswordPromptDialog } from "./PasswordPromptDialog";
import { changeLockPassword, setLockPassword, type VerifyResult } from "../model/groupLock";

vi.mock("../model/groupLock", () => ({
  lockCooldownMs: () => 0,
  changeLockPassword: vi.fn(),
  setLockPassword: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const submit = () =>
  document
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

it("recovers from verification failure after StrictMode effect replay", async () => {
  vi.mocked(changeLockPassword).mockResolvedValue({
    ok: false,
    reason: "no-password",
    retryAfterMs: 0,
  });
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(SetLockPasswordDialog, { mode: "change", onClose }),
      ),
    ),
  );
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  inputs[0].value = "old-password";
  inputs[1].value = inputs[2].value = "new-password";
  await act(async () => {
    submit();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "No lock password is set.",
  );
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps password setup open and retryable when storing the password fails", async () => {
  vi.mocked(setLockPassword).mockRejectedValue(new Error("Storage unavailable"));
  const onClose = vi.fn();
  await act(async () =>
    root.render(createElement(SetLockPasswordDialog, { mode: "set", onClose })),
  );
  document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    input.value = "new-password";
  });
  await act(async () => {
    submit();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Storage unavailable");
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

it("does not run the prompt completion callback after its dialog unmounts", async () => {
  let resolve!: (value: VerifyResult) => void;
  const result = new Promise<VerifyResult>((done) => {
    resolve = done;
  });
  const onDone = vi.fn();
  await act(async () =>
    root.render(
      createElement(PasswordPromptDialog, {
        title: "Unlock",
        description: "",
        submitLabel: "Unlock",
        verify: () => result,
        onDone,
        onClose: vi.fn(),
      }),
    ),
  );
  document.querySelector<HTMLInputElement>('input[type="password"]')!.value = "password";
  act(() => {
    submit();
  });
  act(() => root.render(null));
  await act(async () => {
    resolve({ ok: true });
  });
  expect(onDone).not.toHaveBeenCalled();
});

it("renders verification exceptions and enables retry", async () => {
  await act(async () =>
    root.render(
      createElement(PasswordPromptDialog, {
        title: "Unlock",
        description: "",
        submitLabel: "Unlock",
        verify: async () => {
          throw new Error("Could not read settings");
        },
        onDone: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  document.querySelector<HTMLInputElement>('input[type="password"]')!.value = "password";
  await act(async () => {
    submit();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Could not read settings");
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
});
