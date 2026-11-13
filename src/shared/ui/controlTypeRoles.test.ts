import { Switch } from "./Switch";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { WorkingIndicator } from "./WorkingIndicator";
import { Spinner } from "./Spinner";
import { TabLabel } from "./TabLabel";

it("keeps a dense pending glyph at its explicit micro size without another announcement", () => {
  const html = renderToStaticMarkup(createElement(Spinner, { size: "micro" }));
  expect(html).toContain('data-size="micro"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('role="status"');
});

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

it("keeps native choice contracts when a labeled card owns its presentation", () => {
  const check = renderToStaticMarkup(
    createElement(Checkbox, {
      appearance: "card",
      label: "Optional tool",
      name: "tool",
      value: "notes",
      required: true,
      defaultChecked: true,
    }),
  );
  expect(check).toContain('data-choice-appearance="card"');
  expect(check).toContain("<label");
  expect(check.match(/<input/g)).toHaveLength(1);
  expect(check).toContain('name="tool"');
  expect(check).toContain('value="notes"');
  expect(check).toContain('required=""');
  expect(check).toContain('checked=""');
  expect(check).not.toContain(" appearance=");
  const toggle = renderToStaticMarkup(
    createElement(Switch, {
      appearance: "card",
      label: "Keep awake",
      checked: true,
      disabled: true,
    }),
  );
  expect(toggle).toContain('data-choice-appearance="card"');
  expect(toggle).toContain('role="switch"');
  expect(toggle).toContain('aria-checked="true"');
  expect(toggle).toContain('disabled=""');
  expect(toggle).not.toContain(" appearance=");
});
