// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

it.each(
  [
    { side: undefined, left: 40, expected: "bottom" },
    { side: "right" as const, left: 40, expected: "right" },
    { side: "right" as const, left: 700, expected: "left" },
  ].flatMap((placement) => [false, true].map((multiple) => ({ ...placement, multiple }))),
)(
  "places $side dropdown at $left on $expected side (multiple=$multiple)",
  async ({ side, left, expected, multiple }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 800);
    vi.stubGlobal("innerHeight", 600);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(SearchableSelect, {
            label: "Repositories",
            side,
            ...(multiple
              ? { multiple: true as const, value: ["a"], onChange: vi.fn() }
              : { value: "a", onChange: vi.fn() }),
            options: [
              { value: "a", label: "acme/app" },
              { value: "b", label: "other/app" },
            ],
          }),
        ),
      );
      const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(left, 100, 80, 28));
      await act(async () => trigger.click());
      const menu = document.querySelector<HTMLElement>('[aria-label="Repositories options"]')!;
      expect(menu.dataset.popoverSide).toBe(expected);
      const frame = menu.parentElement!;
      expect(Number.parseFloat(frame.style.left)).toBeGreaterThanOrEqual(8);
      expect(
        Number.parseFloat(frame.style.left) + Number.parseFloat(frame.style.width),
      ).toBeLessThanOrEqual(792);
      const search = menu.querySelector<HTMLInputElement>("input")!;
      await act(async () =>
        search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      );
      expect(document.querySelector('[aria-label="Repositories options"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
