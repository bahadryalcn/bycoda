// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RailAction } from "./RailAction";
import { Inbox } from "../../shared/ui/icons";

it("opens Inbox context actions from the keyboard without navigating", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClick = vi.fn();
  const onOpenContextMenu = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(RailAction, {
          label: "Inbox",
          icon: Inbox,
          onClick,
          onOpenContextMenu,
        }),
      ),
    );
    const button = container.querySelector("button")!;
    act(() =>
      button.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onOpenContextMenu).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps the icon leading when a count is present", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(RailAction, { label: "Inbox", icon: Inbox, badge: 7, onClick: vi.fn() }),
      ),
    );
    const button = container.querySelector("button")!;
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(button.textContent).toContain("Inbox7");
    expect(button.querySelector("svg")?.classList.contains("ml-4")).toBe(false);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
