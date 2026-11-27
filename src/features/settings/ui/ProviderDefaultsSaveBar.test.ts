// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderDefaultsSaveBar, type DefaultsSaveState } from "./ProviderDefaultsSaveBar";
import { ProviderDefaultsScopeRow } from "./providerDefaultsTargetsPicker";

const changesOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: String(index), label: `Field ${index}` }));

it("confirms saved defaults in the action while retaining unsaved counts and save errors", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (pending: number, saveState: DefaultsSaveState, saving = false) => {
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsSaveBar, {
          changes: changesOf(pending),
          saveState,
          saving,
          onSave: vi.fn(),
          onDiscard: vi.fn(),
        }),
      ),
    );
  };
  try {
    await render(0, { state: "saved", target: "Global" });
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.startsWith("Saved"),
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("unsaved");
    await render(2, { state: "saved", target: "Global" });
    expect(container.textContent).toContain("2 unsaved changes");
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Save"),
    ).toBe(true);
    await render(2, { state: "error", message: "Storage unavailable" });
    expect(container.textContent).toContain("Storage unavailable");
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
    ).toBe(true);
    await render(2, { state: "idle" }, true);
    for (const label of ["Save", "Discard"]) {
      const button = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === label || node.textContent === "Saving…",
      )!;
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("offers one-provider or all-providers at save time, not in the scope row", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDraftChange = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsSaveBar, {
          changes: changesOf(1),
          saveState: { state: "idle" },
          onSave: vi.fn(),
          onDiscard: vi.fn(),
          activeProvider: "codex",
          providers: ["codex", "claude"],
          draft: { providers: {}, accounts: {} },
          onDraftChange,
        }),
      ),
    );
    const group = container.querySelector('[role="radiogroup"][aria-label="Apply to"]');
    expect(group).not.toBeNull();
    await act(async () =>
      [...group!.querySelectorAll<HTMLElement>('[role="radio"]')]
        .find((radio) => radio.textContent?.includes("All providers"))!
        .click(),
    );
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ providerScope: "all" }));
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsScopeRow, {
          target: { kind: "global" },
          onTargetChange: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).toContain("Where these settings apply");
    expect(container.querySelector('[aria-label="Apply to"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows where defaults are saved above the fields, not in the save bar", async () => {
  const css = readFileSync("src/features/settings/ui/ProviderDefaults.css", "utf8");
  expect(css).not.toMatch(/\[aria-label/);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsScopeRow, {
          target: { kind: "global" },
          onTargetChange: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).toContain("Where these settings apply");
    expect(
      container.querySelector('[role="radiogroup"][aria-label="Where these settings apply"]'),
    ).not.toBeNull();
    expect(container.querySelector("button[aria-haspopup='dialog']")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
