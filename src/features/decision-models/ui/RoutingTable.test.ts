// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoutingTable } from "./RoutingTable";

it("keeps ordered source names and their count inside the selector", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(RoutingTable, {
          routing: {
            screen_state: { sourceIds: ["clef-flash", "Clef-Flash-Q4_K_M"], threshold: 0.85 },
          },
          sources: [],
          busy: false,
          onSave: vi.fn(),
        }),
      ),
    );
    const trigger = container.querySelector("button")!;
    expect(trigger.textContent).toContain("1 clef-flash, 2 Clef-Flash-Q4_K_M");
    expect(trigger.querySelector('[data-size="xs"]')?.textContent).toBe("2");
    expect(container.querySelector("ol")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("confirms persisted routing on its save button and clears confirmation on edits", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const save = vi.fn().mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        createElement(RoutingTable, {
          routing: { screen_state: { sourceIds: ["s1"], threshold: 0.9 } },
          sources: [],
          busy: false,
          onSave: save,
        }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const edit = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await edit("0.8");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Save routing")!
        .click(),
    );
    expect(save).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(RoutingTable, {
          routing: save.mock.calls[0][0],
          sources: [],
          busy: false,
          onSave: save,
        }),
      ),
    );
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Saved"),
    ).toBe(true);
    expect(container.textContent).not.toContain("Saved.");
    await edit("0.7");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Save routing",
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
