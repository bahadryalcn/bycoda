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
      pinning: false,
      onReview: () => undefined,
      onReveal: () => undefined,
      pin: { onToggle: () => undefined },
      remove: { label: "Delete directory", onRemove: () => undefined },
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

it("adds a keyboard-focusable status icon only for a missing folder", () => {
  expect(render()).not.toContain('role="img" aria-label="Folder"');
  expect(render({ missing: true })).toContain('role="img" aria-label="Folder" tabindex="0"');
});

it("adds the relative cleanup time to the caption when cleanup is scheduled", () => {
  expect(render()).not.toContain("Cleanup ");
  expect(render({ cleanupDueAt: Date.now() + 3 * 24 * 60 * 60 * 1000 })).toMatch(/Cleanup [^<]+/);
});

it("keeps details collapsed until the summary opens them", () => {
  const html = render();
  expect(html).toContain("<details");
  expect(html).not.toMatch(/<details[^>]*\sopen/);
});

it("puts every row action inline instead of behind a menu", () => {
  const html = render({ remove: { label: "Remove record", onRemove: () => undefined } });
  expect(html).not.toContain('aria-haspopup="menu"');
  for (const label of ["Reveal folder", "Pin workspace", "Remove record"])
    expect(html).toContain(`aria-label="${label}"`);
  expect(render({ workspace: { ...workspace, pinned: true } })).toContain(
    'aria-label="Unpin workspace"',
  );
});

it("shows background removal on the row and blocks its actions", () => {
  const html = render({ removing: true });
  expect(html).toContain('role="img" aria-label="Directory removal" tabindex="0"');
  expect(html).toMatch(
    /aria-label="Delete directory"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Delete directory"/,
  );
});
