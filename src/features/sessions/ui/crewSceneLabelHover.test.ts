// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { reachWhenClipped } from "./crewLabelFocus";

it("reveals a clipped crew member's full name and context on pointer hover", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    const hint = "Research Lead · Context: 70%";
    act(() =>
      root.render(
        createElement(
          OverflowTooltip,
          { label: hint },
          createElement(
            "span",
            {
              ref: reachWhenClipped,
              className: "crew-scene__label",
              style: { overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            },
            "Research Lead",
          ),
        ),
      ),
    );
    const label = container.querySelector(".crew-scene__label[data-clipped]")!;
    act(() => {
      label.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      vi.advanceTimersByTime(1000);
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(hint);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
