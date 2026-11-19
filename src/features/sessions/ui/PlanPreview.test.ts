import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanPreview } from "./PlanPreview";

const text = "# Ship the thing\n\nDo the work in order.";

function countButtons(markup: string) {
  return (markup.match(/<button\b/g) ?? []).length;
}

describe("plan card open control", () => {
  it("exposes one open action, named by the plan title, when both open and build are present", () => {
    const markup = renderToStaticMarkup(
      createElement(PlanPreview, { text, onOpen: () => {}, onBuild: () => {} }),
    );

    expect(markup).toContain("Ship the thing");
    expect(markup).not.toContain("Open in pane");
    expect(markup).not.toContain("Open plan in pane");
    expect(markup).not.toMatch(/>\s*Open\s*</);
    // One title button for opening, one Build button.
    expect(countButtons(markup)).toBe(2);
    expect(markup).toContain("Build");
  });

  it("keeps the title as the only open control when there is no build action", () => {
    const markup = renderToStaticMarkup(createElement(PlanPreview, { text, onOpen: () => {} }));

    expect(markup).toContain("Ship the thing");
    expect(markup).not.toContain("Open in pane");
    expect(markup).not.toContain("Open plan in pane");
    expect(countButtons(markup)).toBe(1);
  });

  it("renders the title as plain text and keeps Build when the card cannot open", () => {
    const markup = renderToStaticMarkup(createElement(PlanPreview, { text, onBuild: () => {} }));

    expect(markup).toContain("Ship the thing");
    expect(markup).not.toContain("Open in pane");
    expect(countButtons(markup)).toBe(1);
    expect(markup).toContain("Build");
  });

  it("keeps Build disabled while the agent is busy", () => {
    const markup = renderToStaticMarkup(
      createElement(PlanPreview, { text, busy: true, onOpen: () => {}, onBuild: () => {} }),
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Build/);
  });
});
