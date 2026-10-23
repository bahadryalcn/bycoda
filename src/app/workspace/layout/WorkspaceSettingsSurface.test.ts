// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  WorkspaceSettingsSurface,
  type WorkspaceSettingsSurfaceProps,
} from "./WorkspaceSettingsSurface";

const { manage, remove } = vi.hoisted(() => ({ manage: vi.fn(), remove: vi.fn() }));
vi.mock("../../../features/source-control/ui/WorktreesPage", () => ({
  WorktreesPage: (props: unknown) => {
    manage(props);
    return "Worktree management";
  },
}));
vi.mock("../../../features/source-control/ui/QuickDeleteWorktreeDialog", () => ({
  QuickDeleteWorktreeDialog: (props: unknown) => {
    remove(props);
    return "Delete worktree?";
  },
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../shared/i18n/git", () => ({ t: (key: string) => key, useLocale: () => "en" }));
vi.mock("../surfaces/lazySurfaces", () => ({
  SettingsView: () => null,
  preloadToolSurface: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function props(deletePath?: string): WorkspaceSettingsSurfaceProps {
  return {
    worktreeManagementRequest: { cwd: "remote://mac/repo", deletePath },
    worktreeManagementRevision: 1,
    setWorktreeManagementRequest: vi.fn(),
    settingsOpen: false,
    visibleRecents: [],
    sessions: [],
    onRemoveWorktree: vi.fn(),
    onCheckWorktreeRemoval: vi.fn(),
    onDeleteWorktreeSessions: vi.fn(),
  } as unknown as WorkspaceSettingsSurfaceProps;
}

it("opens management for a general request and forwards repository and deletion safeguards", () => {
  const input = props();
  const html = renderToStaticMarkup(createElement(WorkspaceSettingsSurface, input));
  expect(html).toContain("Worktree management");
  expect(remove).not.toHaveBeenCalled();
  expect(manage).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: "remote://mac/repo",
      recents: input.visibleRecents,
      liveSessions: input.sessions,
    }),
  );
  expect(input.onRemoveWorktree).not.toHaveBeenCalled();
  // Handlers reach the page as stable proxies that call the workspace's own.
  const forwarded = manage.mock.calls[0][0] as Record<string, (...args: unknown[]) => unknown>;
  forwarded.onRemove("a");
  forwarded.onCheckRemove("b");
  forwarded.onDeleteSessions("c");
  expect(input.onRemoveWorktree).toHaveBeenCalledWith("a");
  expect(input.onCheckWorktreeRemoval).toHaveBeenCalledWith("b");
  expect(input.onDeleteWorktreeSessions).toHaveBeenCalledWith("c");
});

it("keeps targeted deletion in the quick confirmation", () => {
  const input = props("remote://mac/worktrees/feature");
  const html = renderToStaticMarkup(createElement(WorkspaceSettingsSurface, input));
  expect(html).toContain("Delete worktree?");
  expect(manage).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith(
    expect.objectContaining({ request: input.worktreeManagementRequest }),
  );
  expect(input.onRemoveWorktree).not.toHaveBeenCalled();
  const forwarded = remove.mock.calls[0][0] as { onRemove: (...args: unknown[]) => unknown };
  forwarded.onRemove("feature");
  expect(input.onRemoveWorktree).toHaveBeenCalledWith("feature");
});
