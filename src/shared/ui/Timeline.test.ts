// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { Timeline } from "./Timeline";

const events = [{ id: "merge", at: Date.now() - 60_000, title: "merged Checkout redesign" }];

it("renders the timeline on its first render without waiting for an effect", () => {
  const html = renderToString(createElement(Timeline, { label: "History", events }));
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-label="History"');
  expect(html).toContain("merged Checkout redesign");
});

it("keeps the empty region on its first render when there are no events", () => {
  const html = renderToString(createElement(Timeline, { label: "History", events: [] }));
  expect(html).toContain('aria-label="History"');
  expect(html).not.toContain("merged Checkout redesign");
});
