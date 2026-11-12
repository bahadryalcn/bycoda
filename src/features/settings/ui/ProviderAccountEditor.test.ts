// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderAccountEditor } from "./ProviderAccountEditor";

it("keeps Cancel usable while waiting for browser sign-in and blocks duplicate submissions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onCancel = vi.fn();
  const onSubmit = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(ProviderAccountEditor, {
          editor: { provider: "codex", label: "Personal" },
          working: true,
          onLabel: vi.fn(),
          onCancel,
          onSubmit,
        }),
      ),
    );
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    )!;
    expect(cancel.disabled).toBe(false);
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(submit.getAttribute("aria-busy")).toBe("true");
    act(() => {
      submit.click();
      submit.click();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("shows name color and kind fields for metadata edits without a sign-in action", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onMetadata = vi.fn();
  const stored = localStorage.getItem("bycoda.providerAccounts.v2");
  try {
    act(() =>
      root.render(
        createElement(ProviderAccountEditor, {
          editor: {
            provider: "codex",
            accountId: "default",
            label: "Office",
            kind: "work",
            color: "teal",
          },
          working: false,
          onLabel: vi.fn(),
          onMetadata,
          onCancel: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );
    expect(container.querySelector("input")?.value).toBe("Office");
    expect(container.textContent).toContain("Kind");
    expect(container.textContent).toContain("Work");
    expect(container.textContent).toContain("Color");
    expect(container.querySelector('button[aria-label="Color for Office: Teal"]')).not.toBeNull();
    expect(container.textContent).toContain("Save");
    expect(container.textContent).not.toContain("Sign in and add");
    act(() =>
      container.querySelector<HTMLInputElement>('input[type="radio"][value="personal"]')!.click(),
    );
    expect(onMetadata).toHaveBeenCalledWith({ kind: "personal" });
    const automatic = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Automatic",
    )!;
    act(() => automatic.click());
    expect(onMetadata).toHaveBeenCalledWith({ kind: undefined });
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Color for Office: Teal"]')!
        .click(),
    );
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Blue"]')!.click());
    expect(onMetadata).toHaveBeenCalledWith({ color: "blue" });
    expect(localStorage.getItem("bycoda.providerAccounts.v2")).toBe(stored);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("rejects blank and duplicate account names before submitting", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSubmit = vi.fn();
  try {
    for (const label of ["   ", " office "]) {
      act(() =>
        root.render(
          createElement(ProviderAccountEditor, {
            editor: { provider: "codex", accountId: "default", label },
            existingLabels: ["Office"],
            working: false,
            onLabel: vi.fn(),
            onCancel: vi.fn(),
            onSubmit,
          }),
        ),
      );
      expect(container.querySelector('button[type="submit"]')?.getAttribute("aria-disabled")).toBe(
        "true",
      );
      act(() =>
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    }
    expect(onSubmit).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
