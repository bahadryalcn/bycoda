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
  try {
    act(() =>
      root.render(
        createElement(ProviderAccountEditor, {
          editor: { provider: "codex", label: "Personal" },
          working: true,
          onLabel: vi.fn(),
          onCancel,
          onSubmit: vi.fn(),
        }),
      ),
    );
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    )!;
    expect(cancel.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
