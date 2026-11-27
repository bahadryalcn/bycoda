// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GitPickDialog } from "./GitPickDialog";

it("keeps a filtered Git list bounded and picks a match by its original id", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom has no layout. Supply a list viewport and measured row height.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const items = Array.from({ length: 200 }, (_, index) => ({
    id: `id-${index}`,
    label: `branch-${index}`,
    detail: index < 100 ? "local" : "origin",
  }));
  const onPick = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(GitPickDialog, {
          title: "Branches",
          placeholder: "Filter branches",
          items,
          emptyText: "Empty",
          onCancel: vi.fn(),
          onPick,
        }),
      ),
    );
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "origin",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = document.querySelectorAll<HTMLElement>('[role="option"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]?.getAttribute("aria-setsize")).toBe("100");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onPick.mock.calls.map(([id]) => id)).toEqual(["id-100"]);
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
