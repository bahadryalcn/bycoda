// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => [],
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: undefined, refresh: async () => false }),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

// Opening a session from another project follows that project; its remembered tab
// (for example Changes) must not replace the Sessions list the click came from.
it("keeps the Sessions tab for the project of a session opened from the list", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const props: ComponentProps<typeof Sidebar> = {
    cwd: "/workspace/project",
    open: true,
    sessions: [
      {
        id: "other",
        cwd: "/workspace/other",
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        title: "Other project session",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(Sidebar, props)));
  const card = container.querySelector<HTMLElement>('[data-session-card="other"]')!;
  await act(async () => card.click());
  expect(props.onTabChange).toHaveBeenCalledExactlyOnceWith("sessions", "/workspace/other");
  expect(props.onSelectSession).toHaveBeenCalledExactlyOnceWith("other", { keepOpen: false });
});
