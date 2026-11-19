import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CheckoutIdentity } from "./CheckoutIdentity";

const branch = "by/fix-the-long-shared-prefix-branch-name-that-differs-at-the-end";

it("discloses a clipped checkout branch through the shared MiddleTruncate pattern", () => {
  const markup = renderToStaticMarkup(
    createElement(CheckoutIdentity, { name: "repo", index: { branch, head: "abc1234def" } }),
  );
  // The complete name is kept once, in the accessibility tree; the visual halves are aria-hidden.
  expect(markup).toContain("data-middle-truncate");
  expect(markup.split(branch).length - 1).toBe(1);
  expect(markup).toContain('aria-hidden="true"');
  // Native title bubbles are not used; the overflow hint comes from the shared tooltip.
  expect(markup).not.toContain('title="');
});
