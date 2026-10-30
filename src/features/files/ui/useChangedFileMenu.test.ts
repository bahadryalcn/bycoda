// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  openPathWithDefaultApp: vi.fn(),
  revealPath: vi.fn(),
}));
vi.mock("../../sessions/ui/MarkdownModeToggle", () => ({
  setMarkdownViewMode: vi.fn(),
}));
import { useChangedFileMenu } from "./useChangedFileMenu";

function Row({ onOpenChanges }: { onOpenChanges: () => void }) {
  const { menu, openFrom, isOpen, ...handlers } = useChangedFileMenu({
    path: "/repo/src/a.ts",
    relative: "src/a.ts",
    onOpenChanges,
    actions: [
      { id: "discard", label: "Discard Changes", danger: true, run: vi.fn() },
    ],
  });
  return createElement(
    "div",
    { ...handlers, "data-testid": "row" },
    createElement("button", {
      type: "button",
      "aria-haspopup": "menu",
      "aria-expanded": isOpen,
      onClick: (event: { currentTarget: HTMLElement }) =>
        openFrom(event.currentTarget),
    }),
    menu,
  );
}

it("opens the same row menu from a visible control and returns focus to it on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(Row, { onOpenChanges: vi.fn() })),
    );
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = document.querySelector("[role=menu]");
    expect(menu).not.toBeNull();
    // The visible control reaches the secondary actions that right-click reaches.
    expect(menu!.textContent).toContain("Discard Changes");
    expect(menu!.textContent).toContain("View Changes");
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
