// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderAccountEditor } from "./ProviderAccountsSettings";

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
