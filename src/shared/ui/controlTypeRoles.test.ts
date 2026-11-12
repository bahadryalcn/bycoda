import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { WorkingIndicator } from "./WorkingIndicator";
import { Spinner } from "./Spinner";
import { TabLabel } from "./TabLabel";

it("keeps default roles absent and applies explicit roles to control text", () => {
  expect(renderToStaticMarkup(createElement(Spinner))).not.toContain("data-tone");
  expect(renderToStaticMarkup(createElement(Spinner, { tone: "muted", size: "xs" }))).toContain(
    'data-tone="muted"',
  );
  expect(renderToStaticMarkup(createElement(Checkbox, { label: "Choice" }))).not.toContain(
    "data-tone",
  );
  expect(
    renderToStaticMarkup(createElement(Checkbox, { label: "Choice", weight: "medium" })),
  ).toContain('data-weight="medium"');
  expect(
    renderToStaticMarkup(
      createElement(Disclosure, { summary: "Details", textSize: "caption", tone: "secondary" }),
    ),
  ).toContain('data-tone="secondary"');
  expect(
    renderToStaticMarkup(
      createElement(WorkingIndicator, { text: { size: "micro" }, children: "Working" }),
    ),
  ).toContain('data-size="micro"');
  for (const truncate of ["end", "middle"] as const) {
    expect(
      renderToStaticMarkup(createElement(TabLabel, { truncate, tone: "muted", children: "Label" })),
    ).toContain('data-tone="muted"');
  }
});
