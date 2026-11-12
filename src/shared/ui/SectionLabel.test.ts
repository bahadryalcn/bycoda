// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SectionLabel } from "./SectionLabel";

describe("SectionLabel", () => {
  it("renders a standalone menu caption without extra wrappers", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(SectionLabel, { variant: "menu", children: "Projects" }),
    );
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.firstElementChild?.children).toHaveLength(0);
    expect(container.textContent).toBe("Projects");
  });

  it("splits the chevron from the label so each runs its own action", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onExpandedChange = vi.fn();
    const onClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(() =>
      root.render(
        createElement(SectionLabel, {
          collapsible: true,
          expanded: true,
          onExpandedChange,
          labelAction: { label: "Open Crews", toggleLabel: "Crews", onClick },
          children: "Crews",
        }),
      ),
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Crews");
    expect(buttons[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(buttons[1]!.getAttribute("aria-label")).toBe("Open Crews");
    expect(buttons[1]!.hasAttribute("aria-expanded")).toBe(false);
    await act(() => buttons[1]!.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(onExpandedChange).not.toHaveBeenCalled();
    await act(() => buttons[0]!.click());
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    expect(onClick).toHaveBeenCalledOnce();
    await act(() => root.unmount());
    container.remove();
  });
});
