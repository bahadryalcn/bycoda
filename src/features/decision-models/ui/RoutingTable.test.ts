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
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    const trigger = container.querySelector('button[aria-haspopup="dialog"]')!;
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
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
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

it("keeps automatic tasks compact until customization is requested", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(RoutingTable, { routing: {}, sources: [], busy: false, onSave: vi.fn() }),
      ),
    );
    expect(container.querySelector('input[inputmode="decimal"]')).toBeNull();
    expect(container.textContent).not.toContain("Save routing");
    expect(container.textContent).toContain("Automatic: local models first");
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    expect(container.querySelector('input[inputmode="decimal"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("retains routing edits when privacy returns equivalent saved routing and discards explicitly", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const routing = { screen_state: { sourceIds: ["s1"], threshold: 0.9 } };
  const props = { routing, sources: [], busy: false, onSave: vi.fn() };
  try {
    await act(async () => root.render(createElement(RoutingTable, props)));
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.8");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      root.render(createElement(RoutingTable, { ...props, routing: structuredClone(routing) })),
    );
    expect(input.value).toBe("0.8");
    expect(container.textContent).toContain("1 unsaved changes");
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Discard")!.click(),
    );
    expect(input.value).toBe("0.90");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps localized decimal drafts, validates bounds, and steps by one hundredth", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const save = vi.fn().mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        createElement(RoutingTable, {
          routing: { screen_state: { sourceIds: ["s1"], threshold: 0.8 } },
          sources: [],
          busy: false,
          onSave: save,
        }),
      ),
    );
    expect(container.querySelector('input[inputmode="decimal"]')).toBeNull();
    expect(container.textContent).toContain("0.80");
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    const edit = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await edit("1.01");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await edit("0,75");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Increase value"]')!.click(),
    );
    expect(input.value).toBe("0.76");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Save routing")!
        .click(),
    );
    expect(save.mock.calls[0][0].screen_state.threshold).toBe(0.76);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
