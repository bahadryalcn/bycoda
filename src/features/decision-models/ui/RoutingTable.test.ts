// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoutingTable } from "./RoutingTable";
import { SourceOrderPicker } from "./SourceOrderPicker";
import { setInputValue } from "./decisionTestDom";

it("distinguishes a source search miss and clears only the search", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(SourceOrderPicker, {
          label: "Fallback",
          value: ["source"],
          sources: [
            { id: "source", name: "Alpha", kind: "local", adapter: "systemone", status: "ready" },
          ],
          disabled: false,
          onChange: change,
        }),
      ),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    setInputValue(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, "Unmatched");
    expect(document.body.textContent).toContain("No results");
    expect(document.body.textContent).not.toContain("No sources connected");
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Clear search")!
        .click(),
    );
    expect(document.body.textContent).toContain("Alpha");
    expect(change).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(["0.8", "unfinished"])(
  "keeps the owner's threshold draft across incoming Host routing: %s",
  async (value) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const save = vi.fn();
    const render = (threshold: number) =>
      root.render(
        createElement(RoutingTable, {
          routing: { generic: { sourceIds: ["source"], threshold } },
          sources: [],
          busy: false,
          onSave: save,
        }),
      );
    try {
      await act(async () => render(0.9));
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "Customize")!
          .click(),
      );
      const field = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
      setInputValue(field, value);
      await act(async () => render(0.7));
      expect(field.value).toBe(value);
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (entry) => entry.textContent === "Save routing",
      )!;
      expect(button.disabled).toBe(value === "unfinished");
      expect(save).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

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
    expect(trigger.textContent).toContain("1 clef-flash");
    expect(trigger.textContent).toContain("2 Clef-Flash-Q4_K_M");
    expect(trigger.querySelectorAll('[data-size="xs"]')).toHaveLength(2);
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
    expect(container.querySelector('input[inputmode="decimal"]')).toBeNull();
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    expect(container.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull();
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

it("resets a custom task without changing other task routes", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSave = vi.fn().mockResolvedValue({});
  const route = { sourceIds: ["s1"], threshold: 0.7 };
  try {
    await act(async () =>
      root.render(
        createElement(RoutingTable, {
          routing: { screen_state: route, generic: route },
          sources: [],
          busy: false,
          onSave,
        }),
      ),
    );
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Customize")!.click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reset to automatic"]')!
        .click(),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Save routing")!
        .click(),
    );
    expect(onSave.mock.calls[0][0]).toEqual({ generic: route });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
