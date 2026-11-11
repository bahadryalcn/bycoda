// @vitest-environment happy-dom
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RailSectionHeader } from "./useRailSections";
import { SessionRecoveryControl } from "./SessionRecoveryControl";

it("routes plain, disclosure, split and recovery rail headings through the same layout slots", () => {
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
      createElement(SessionRecoveryControl, { count: 2, onOpen: () => {} }),
    ),
  );
  const headers = container.querySelectorAll("[data-rail-section-header]");
  expect(headers).toHaveLength(4);
  for (const header of headers) {
    expect(header.querySelector("[data-rail-section-mark]")).not.toBeNull();
    expect(header.querySelector("[data-rail-section-text]")).not.toBeNull();
  }
  expect(headers[2]?.querySelectorAll("button")).toHaveLength(2);
  expect(headers[3]?.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Recovered sessions (2)",
  );
});
