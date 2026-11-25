// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { Select } from "./Select";
import { WorkingIndicator } from "./WorkingIndicator";

it("exposes a Checkbox disabledReason only while it is disabled", () => {
  const disabled = renderToStaticMarkup(
    createElement(Checkbox, { label: "Sync", disabled: true, disabledReason: "Sign in first" }),
  );
  expect(disabled).toContain("Sign in first");
  expect(disabled).toContain("aria-describedby");
  const enabled = renderToStaticMarkup(
    createElement(Checkbox, { label: "Sync", disabledReason: "Sign in first" }),
  );
  expect(enabled).not.toContain("Sign in first");
});

it("exposes a Select disabledReason only while it is disabled", () => {
  const props = { label: "Mode", value: "a", options: [{ value: "a", label: "A" }] };
  const disabled = renderToStaticMarkup(
    createElement(Select, {
      ...props,
      disabled: true,
      disabledReason: "Locked by policy",
      onValueChange: () => {},
    }),
  );
  expect(disabled).toContain('aria-description="Locked by policy"');
  const enabled = renderToStaticMarkup(
    createElement(Select, { ...props, disabledReason: "Locked", onValueChange: () => {} }),
  );
  expect(enabled).not.toContain("aria-description");
});

it("makes a labelled WorkingIndicator or a Disclosure a live region on request", () => {
  expect(
    renderToStaticMarkup(createElement(WorkingIndicator, { live: true }, "Working")),
  ).toContain('role="status"');
  expect(renderToStaticMarkup(createElement(WorkingIndicator, null, "Working"))).not.toContain(
    "role=",
  );
  expect(
    renderToStaticMarkup(
      createElement(Disclosure, { summary: "Work", collapsible: false, live: true }),
    ),
  ).toContain('role="status"');
  expect(
    renderToStaticMarkup(createElement(Disclosure, { summary: "Work", live: true }, "Body")),
  ).toContain('aria-live="polite"');
});
