// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatRow, StatTile } from "./StatTile";
import { SubTabs } from "./SubTabs";

describe("StatRow", () => {
  it("renders labelled figures and makes only openable tiles buttons", () => {
    const html = renderToStaticMarkup(
      createElement(StatRow, {
        label: "Today",
        children: [
          createElement(StatTile, { key: "w", label: "Waiting", value: "3", onOpen: () => {} }),
          createElement(StatTile, { key: "d", label: "Done", value: "8" }),
        ],
      }),
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Today");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).toContain("Done");
  });
});

describe("SubTabs", () => {
  it("renders a tablist with the selected tab marked", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(SubTabs, {
        label: "Sections",
        value: "b",
        onValueChange: () => {},
        items: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe("B");
  });
});
