// @vitest-environment happy-dom
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RailSectionHeader } from "./useRailSections";

it("routes plain, disclosure and split rail headings through the same layout slots", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(RailSectionHeader, { label: "Pinned" }),
      createElement(RailSectionHeader, { label: "Groups", onToggleCollapsed: () => {} }),
      createElement(RailSectionHeader, {
        label: "Crews",
        onToggleCollapsed: () => {},
        onLabelClick: () => {},
      }),
    ),
  );
  const headers = container.querySelectorAll("[data-rail-section-header]");
  expect(headers).toHaveLength(3);
  for (const header of headers) {
    expect(header.querySelector("[data-rail-section-mark]")).not.toBeNull();
    expect(header.querySelector("[data-rail-section-text]")).not.toBeNull();
  }
  expect(headers[2]?.querySelectorAll("button")).toHaveLength(2);
});
