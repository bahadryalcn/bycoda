// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProviderAccountSubtitle } from "./ProviderAccountSubtitle";
import { AccountStatusLabel } from "./ProviderAccountUsage";

const identity = { plan: "Pro", email: undefined } as never;

it("ProviderAccountSubtitle adds no type attribute without a role", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderAccountSubtitle, { identity, className: "x" }),
  );
  expect(html).not.toContain("data-");
  expect(html).toContain("inline-flex min-w-0 items-baseline gap-1 x");
});

it("ProviderAccountSubtitle takes size, tone and truncate, also on the fallback", () => {
  for (const props of [{ identity }, { identity: null, fallback: "No account" }]) {
    const html = renderToStaticMarkup(
      createElement(ProviderAccountSubtitle, {
        ...props,
        size: "micro",
        tone: "muted",
        truncate: true,
      }),
    );
    expect(html).toContain('data-size="micro"');
    expect(html).toContain('data-tone="muted"');
    expect(html).toContain('data-truncate="true"');
  }
});

const status = { tone: "ready", label: "Ready", detail: "back in 3m" } as never;

it("AccountStatusLabel keeps its detail ink by default and takes the new roles", () => {
  const plain = renderToStaticMarkup(createElement(AccountStatusLabel, { status }));
  expect(plain).toContain('data-tone="muted"');
  expect(plain).not.toContain('data-size="micro"');
  const roled = renderToStaticMarkup(
    createElement(AccountStatusLabel, { status, size: "micro", tone: "danger", truncate: true }),
  );
  expect(roled).toContain('data-size="micro"');
  expect(roled).toContain('data-tone="danger"');
  expect(roled).toContain('data-truncate="true"');
});
