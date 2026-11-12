import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AssistantAvatarMark } from "./AssistantAvatar";

const render = (props: object) =>
  renderToStaticMarkup(createElement(AssistantAvatarMark, { value: "AB", name: "Ada", ...props }));

it("renders only the caller's class and no type attribute by default", () => {
  const html = render({ className: "mark" });
  expect(html).toContain('class="mark"');
  expect(html).not.toContain("data-tone");
  expect(html).not.toContain("data-size");
});

it("size, tone, weight and leading become Text role attributes", () => {
  const html = render({ size: "micro", tone: "muted", weight: "medium", leading: "none" });
  expect(html).toContain('data-size="micro"');
  expect(html).toContain('data-tone="muted"');
  expect(html).toContain('data-weight="medium"');
  expect(html).toContain('data-leading="none"');
});
