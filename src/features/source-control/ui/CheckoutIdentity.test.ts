import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CheckoutIdentity, CheckoutStatus } from "./CheckoutIdentity";

const branch = "by/fix-the-long-shared-prefix-branch-name-that-differs-at-the-end";

it("discloses a clipped checkout branch through the shared MiddleTruncate pattern", () => {
  const markup = renderToStaticMarkup(createElement(CheckoutIdentity, { title: branch }));
  // The complete name is kept once, in the accessibility tree; the visual halves are aria-hidden.
  expect(markup).toContain("data-middle-truncate");
  expect(markup.split(branch).length - 1).toBe(1);
  expect(markup).toContain('aria-hidden="true"');
  // Native title bubbles are not used; the overflow hint comes from the shared tooltip.
  expect(markup).not.toContain('title="');
});

it("draws exactly one leading icon: branch for worktrees, repository for repositories", () => {
  const worktree = renderToStaticMarkup(
    createElement(CheckoutIdentity, {
      title: "main",
      detail: "Project folder",
      marker: "This session",
    }),
  );
  expect(worktree.match(/<svg/g)).toHaveLength(1);
  expect(worktree).toContain("lucide-git-branch");
  expect(worktree).not.toContain("Worktree");
  const repository = renderToStaticMarkup(
    createElement(CheckoutIdentity, { title: "mobile", repository: true }),
  );
  expect(repository.match(/<svg/g)).toHaveLength(1);
  expect(repository).toContain("lucide-folder-git-2");
  expect(
    renderToStaticMarkup(createElement(CheckoutIdentity, { title: "x", icon: false })),
  ).not.toContain("<svg");
});

it("orders title, muted folder and marker", () => {
  const markup = renderToStaticMarkup(
    createElement(CheckoutIdentity, { title: "main", detail: "monocode", marker: "This session" }),
  );
  expect(markup.indexOf("main")).toBeLessThan(markup.indexOf("monocode"));
  expect(markup.indexOf("monocode")).toBeLessThan(markup.indexOf("This session"));
});

it("shows the change chip with a dot and count, a dot alone from the record, and muted sync", () => {
  const counted = renderToStaticMarkup(
    createElement(CheckoutStatus, { changes: 37, ahead: 2, behind: 5 }),
  );
  expect(counted).toContain("37");
  expect(counted).toContain('data-variant="dot"');
  expect(counted).toContain("↑2");
  expect(counted).toContain("↓5");
  const recorded = renderToStaticMarkup(createElement(CheckoutStatus, { dirty: true }));
  expect(recorded).toContain('data-variant="dot"');
  expect(recorded).toContain('aria-label="Changes"');
  const clean = renderToStaticMarkup(createElement(CheckoutStatus, { changes: 0, dirty: true }));
  expect(clean).not.toContain('data-variant="dot"');
  expect(clean).not.toContain("↑");
});
