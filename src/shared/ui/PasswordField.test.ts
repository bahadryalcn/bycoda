// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PasswordField } from "./PasswordField";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reveals the same uncontrolled native input preserving ref, focus, selection and form state", async () => {
  const ref = createRef<HTMLInputElement>();
  const change = vi.fn();
  const submit = vi.fn((event) => event.preventDefault());
  await act(async () =>
    root.render(
      createElement(
        "form",
        { onSubmit: submit },
        createElement(PasswordField, {
          ref,
          label: "Device token",
          name: "token",
          required: true,
          defaultValue: "example-token",
          autoComplete: "off",
          onChange: change,
        }),
      ),
    ),
  );
  const input = ref.current!;
  const form = container.querySelector("form")!;
  input.focus();
  input.setSelectionRange(2, 5, "backward");
  const toggle = container.querySelector("button")!;
  expect(input.type).toBe("password");
  expect(input.getAttribute("data-reveal")).toBeNull();
  await act(async () => toggle.click());
  expect(ref.current).toBe(input);
  expect(input.type).toBe("text");
  expect(input.value).toBe("example-token");
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(5);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(input.getAttribute("data-reveal")).toBe("shown");
  expect(input.autocomplete).toBe("off");
  expect(new FormData(form).get("token")).toBe("example-token");
  expect(change).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  input.value = "changed";
  form.reset();
  expect(input.value).toBe("example-token");
  await act(async () => toggle.click());
  expect(input.type).toBe("password");
  expect(input.getAttribute("data-reveal")).toBe("hidden");
});

it("preserves native required validation, names and disabled state", async () => {
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(PasswordField, {
          label: "Secret",
          name: "secret",
          required: true,
          defaultValue: "",
        }),
      ),
    ),
  );
  const input = container.querySelector("input")!;
  expect(input.validity.valueMissing).toBe(true);
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(PasswordField, {
          label: "Secret",
          name: "secret",
          disabled: true,
          required: true,
        }),
      ),
    ),
  );
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(new FormData(container.querySelector("form")!).has("secret")).toBe(false);
});

it("retains native input/change events and explicit reveal labels for controlled credentials", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(PasswordField, {
        label: "SSH credential",
        value: "draft",
        onChange: change,
        messages: { showPassword: "Reveal credential", hidePassword: "Mask credential" },
      }),
    ),
  );
  const input = container.querySelector("input")!;
  const toggle = container.querySelector("button")!;
  expect(toggle.getAttribute("aria-label")).toBe("Reveal credential");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "edit");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(change).toHaveBeenCalledOnce();
  expect(input.value).toBe("draft");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-label")).toBe("Mask credential");
  expect(input.value).toBe("draft");
});
