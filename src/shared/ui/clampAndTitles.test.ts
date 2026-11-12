import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ClampText } from "./ClampText";
import { Heading } from "./Heading";
import { SectionLabel } from "./SectionLabel";

it("renders silent clamps on the requested element with text roles", () => {
  const html = renderToStaticMarkup(
    createElement(ClampText, {
      expandable: false,
      as: "li",
      lines: 2,
      size: "secondary",
      tone: "primary",
      weight: "medium",
      leading: "inherit",
      title: "Full",
      children: "Text",
    }),
  );
  expect(html).toMatch(/^<li /);
  expect(html).toContain('data-size="secondary"');
  expect(html).toContain('data-leading="inherit"');
  expect(html).toContain("--clamp-lines:2");
  expect(html).toContain('title="Full"');
  expect(html).toMatch(/>Text<\/li>$/);
});

it("keeps default heading attributes and exposes optional title roles", () => {
  const normal = renderToStaticMarkup(createElement(Heading, { children: "Title" }));
  expect(normal).toMatch(/^<h2 data-size="section" class="[^"]+">Title<\/h2>$/);
  const custom = renderToStaticMarkup(
    createElement(Heading, {
      size: "caption",
      leading: "inherit",
      truncate: true,
      children: "Title",
    }),
  );
  expect(custom).toContain('data-leading="inherit"');
  expect(custom).toContain('data-truncate="true"');
});

it("renders inline group labels as a single span", () => {
  const html = renderToStaticMarkup(
    createElement(SectionLabel, { variant: "inline", size: "secondary", children: "Group" }),
  );
  expect(html).toMatch(/^<span class="[^"]+" data-size="secondary">Group<\/span>$/);
});
