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

it.each([
  ["", "valid-new", "valid-new", 0],
  ["current", "x", "x", 1],
  ["current", "valid-new", "different", 2],
] as const)(
  "targets password validation at field %s / %s / %s",
  async (old, next, confirm, index) => {
    await act(async () =>
      root.render(createElement(SetLockPasswordDialog, { mode: "change", onClose: vi.fn() })),
    );
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    [old, next, confirm].forEach((value, i) => {
      inputs[i].value = value;
    });
    await act(async () => {
      submit();
    });
    expect(document.activeElement).toBe(inputs[index]);
    expect(inputs[index].getAttribute("aria-invalid")).toBe("true");
    expect(inputs[index].getAttribute("aria-describedby")).toContain("set-lock-password-error");
    expect(changeLockPassword).not.toHaveBeenCalled();
  },
);

it("explains blank verification without calling the verifier", async () => {
  const verify = vi.fn();
  await act(async () =>
    root.render(
      createElement(PasswordPromptDialog, {
        title: "Unlock",
        description: "",
        submitLabel: "Unlock",
        verify,
        onDone: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  await act(async () => {
    submit();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Enter your lock password.");
  expect(verify).not.toHaveBeenCalled();
});

it("keeps an uncontrolled password and native ref through reveal before verification", async () => {
  const verify = vi.fn().mockResolvedValue({ ok: true });
  const onDone = vi.fn();
  await act(async () =>
    root.render(
      createElement(PasswordPromptDialog, {
        title: "Unlock",
        description: "",
        submitLabel: "Unlock",
        verify,
        onDone,
        onClose: vi.fn(),
      }),
    ),
  );
  const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  input.value = "private draft";
  input.focus();
  input.setSelectionRange(3, 7);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Show password"]')!.click(),
  );
  expect(document.querySelector('input[type="text"]')).toBe(input);
  expect(input.value).toBe("private draft");
  expect(input.selectionStart).toBe(3);
  expect(verify).not.toHaveBeenCalled();
  await act(async () => {
    submit();
  });
  expect(verify).toHaveBeenCalledExactlyOnceWith("private draft");
  expect(input.value).toBe("");
  expect(onDone).toHaveBeenCalledOnce();
});

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

it("cannot be dismissed while the check runs and keeps an unsaved change open", async () => {
  let resolve!: (value: VerifyResult) => void;
  const pending = new Promise<VerifyResult>((done) => {
    resolve = done;
  });
  const onDone = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(PasswordPromptDialog, {
        title: "Remove",
        description: "",
        submitLabel: "Remove",
        verify: () => pending,
        onDone,
        onClose,
      }),
    ),
  );
  document.querySelector<HTMLInputElement>('input[type="password"]')!.value = "password";
  act(() => {
    submit();
  });
  const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  const field = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(field.disabled).toBe(true);
  expect(cancel.disabled).toBe(true);
  act(() => cancel.click());
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ ok: true, incomplete: "not-saved" });
  });
  expect(onDone).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be saved");
  expect(cancel.disabled).toBe(false);
  expect(field.disabled).toBe(false);
  expect(field.value).toBe("");
  expect(document.activeElement).toBe(field);
});

it.each(["set", "change"] as const)(
  "locks %s password fields while storing and clears secrets before retry",
  async (mode) => {
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    if (mode === "set") vi.mocked(setLockPassword).mockReturnValueOnce(pending);
    else vi.mocked(changeLockPassword).mockReturnValueOnce(pending);
    const onClose = vi.fn();
    await act(async () => root.render(createElement(SetLockPasswordDialog, { mode, onClose })));
    const fields = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    fields.forEach((field) => {
      field.value = "valid-secret-value";
    });
    await act(async () => {
      submit();
    });
    expect(fields.every((field) => field.disabled)).toBe(true);
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Cancel",
    )!;
    expect(cancel.disabled).toBe(true);
    await act(async () => reject(new Error("Password storage unavailable")));
    expect(fields.every((field) => !field.disabled && field.value === "")).toBe(true);
    expect(document.activeElement).toBe(fields[0]);
    expect(onClose).not.toHaveBeenCalled();
  },
);
