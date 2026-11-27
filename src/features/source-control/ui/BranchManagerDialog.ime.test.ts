// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BranchManagerDialog } from "./BranchManagerDialog";

vi.mock("../hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({ branches: null, settled: true }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

// #1248: Escape that dismisses an IME candidate must not cancel the inline branch-name edit.
it("keeps the new-branch field open when Escape cancels an IME composition", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () =>
      root.render(createElement(BranchManagerDialog, { cwd: "/repo", onClose: vi.fn() })),
    );
    const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("New branch"),
    )!;
    await act(async () => create.click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="New branch name"]')!;
    expect(input).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
      );
    });
    expect(document.querySelector('input[aria-label="New branch name"]')).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true }),
      );
    });
    expect(document.querySelector('input[aria-label="New branch name"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    mount.remove();
  }
});
