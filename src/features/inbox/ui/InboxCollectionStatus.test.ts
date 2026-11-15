// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InboxCollectionStatus } from "./InboxCollectionStatus";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("hides the count for a complete collection", () => {
  expect(
    renderToStaticMarkup(
      createElement(InboxCollectionStatus, { count: 3, total: 3, partial: false, limited: false }),
    ),
  ).toBe("");
});

it("keeps the lower bound and partial state visible", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(InboxCollectionStatus, { count: 3, partial: true, limited: true })),
    );
    expect(container.textContent).toContain("3+ items");
    expect(container.textContent).toContain("Partial");
  } finally {
    await act(async () => root.unmount());
  }
});
