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

it("orders title and muted detail, with no text marker and an agent icon for agent worktrees", () => {
  const markup = renderToStaticMarkup(
    createElement(CheckoutIdentity, { title: "main", detail: "monocode" }),
  );
  expect(markup.indexOf("main")).toBeLessThan(markup.indexOf("monocode"));
  expect(markup).not.toContain("This session");
  const agent = renderToStaticMarkup(
    createElement(CheckoutIdentity, { title: "by/x", agent: true }),
  );
  expect(agent.match(/<svg/g)).toHaveLength(1);
  expect(agent).toContain("lucide-bot");
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
