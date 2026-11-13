// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { parseStandaloneHttpUrl } from "../model/linkPreview";
import { UserLinkIcon } from "./UserLinkIcon";
import { InboxProviderMark } from "../../inbox/public/workItemMentions";
import { Link } from "../../../shared/ui/icons";

it.each([
  ["https://github.com/acme/app/pull/42", "github"],
  ["https://gitlab.com/acme/app", "gitlab"],
  ["https://acme.atlassian.net/browse/PROJ-42", "jira"],
  ["https://example.com", "link"],
  ["https://github.com.example.com", "link"],
  ["https://atlassian.net.example.com", "link"],
] as const)("renders a decorative identity for %s (%s)", (url, provider) => {
  const link = parseStandaloneHttpUrl(url)!;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(UserLinkIcon, { link, className: "test-mark" }),
  );
  expect(host.querySelector("svg.test-mark[aria-hidden]")).not.toBeNull();
  expect(host.textContent).toBe("");
  const expected =
    provider === "link"
      ? createElement(Link, { className: "test-mark", "aria-hidden": "true" })
      : createElement(InboxProviderMark, { provider, className: "test-mark" });
  expect(host.innerHTML).toBe(renderToStaticMarkup(expected));
});
