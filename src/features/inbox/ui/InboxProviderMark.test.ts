import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InboxProviderMark } from "./InboxProviderMark";

const render = (props: object) =>
  renderToStaticMarkup(createElement(InboxProviderMark, { provider: "github", ...props }));

it("renders only the caller's class and no tone attribute by default", () => {
  const html = render({ className: "size-3" });
  expect(html).toContain('class="size-3"');
  expect(html).not.toContain("data-tone");
});

it("tone sets the shared ink on every provider mark", () => {
  for (const provider of ["github", "gitlab", "azuredevops", "linear", "jira", "other"]) {
    const html = render({ provider, tone: "muted", className: "size-3" });
    expect(html).toContain('data-tone="muted"');
    expect(html).toContain("size-3");
  }
});
