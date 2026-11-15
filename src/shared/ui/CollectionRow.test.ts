// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CollectionRow } from "./CollectionRow";

it("renders title, trailing and action as swap slots with one whole-row open button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const open = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(CollectionRow, {
          title: "Plan",
          secondary: "notes",
          trailing: "2h",
          action: createElement("button", { type: "button", "aria-label": "Delete" }),
          seen: true,
          onOpen: open,
        }),
      ),
    );
    const row = host.querySelector<HTMLElement>("[data-collection-row]")!;
    expect(row.dataset.seen).toBe("true");
    const primary = row.querySelector<HTMLButtonElement>("button[data-action-primary]")!;
    expect(primary.textContent).toContain("Plan");
    expect(primary.textContent).toContain("2h");
    expect(primary.contains(row.querySelector("[aria-label=Delete]"))).toBe(false);
    expect(row.querySelector('[data-action-content="rest"]')).not.toBeNull();
    const action = row.querySelector('[data-action-content="interaction"]')!;
    expect(action.getAttribute("data-action-focus")).toBe("within");
    await act(async () => primary.click());
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps a lone trailing value visible when there is no action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(CollectionRow, { title: "A", trailing: "1d" })),
    );
    expect(host.querySelector('[data-action-content="always"]')).not.toBeNull();
    expect(host.querySelector('[data-action-content="interaction"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
