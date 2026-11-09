import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, it } from "vitest";
import type { ManagedWorkspace } from "../model/contracts";
import { WorkspaceManagedRow } from "./WorkspaceManagedRow";

const workspace = {
  id: "workspace-a",
  path: "/repo-worktrees/wt-a",
  owner: { kind: "session", id: "session-a" },
  branchRef: "refs/heads/bycoda/s/branch-a",
  state: "active",
  directoryState: "present",
  pinned: false,
} as ManagedWorkspace;

function render(props: Partial<Parameters<typeof WorkspaceManagedRow>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(WorkspaceManagedRow, {
      workspace,
      title: "Provider settings parity",
      reviewDisabled: false,
      pinning: false,
      menuOpen: false,
      onReview: () => undefined,
      onMenu: () => undefined,
      ...props,
    }),
  );
}

it("shows the folder and branch caption only when the title differs from the branch", () => {
  const html = render();
  expect(html).toContain("wt-a · bycoda/s/branch-a");
  expect(render({ title: "bycoda/s/branch-a" })).toContain(">wt-a<");
  expect(render({ title: "bycoda/s/branch-a" })).not.toContain("bycoda/s/branch-a · ");
});

it("marks a missing folder with a warning chip", () => {
  expect(render()).not.toContain("Missing folder");
  expect(render({ missing: true })).toContain("Missing folder");
});

it("adds the relative cleanup time to the caption when cleanup is scheduled", () => {
  expect(render()).not.toContain("Cleanup ");
  expect(render({ cleanupDueAt: Date.now() + 3 * 24 * 60 * 60 * 1000 })).toMatch(/Cleanup [^<]+/);
});

it("keeps details collapsed until the chevron opens them", () => {
  const html = render();
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("<dl");
});
