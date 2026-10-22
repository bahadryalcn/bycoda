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
vi.mock("../surfaces/lazySurfaces", () => ({ SettingsView: () => null }));

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
      onRemove: input.onRemoveWorktree,
      onCheckRemove: input.onCheckWorktreeRemoval,
      onDeleteSessions: input.onDeleteWorktreeSessions,
    }),
  );
  expect(input.onRemoveWorktree).not.toHaveBeenCalled();
});

it("keeps targeted deletion in the quick confirmation", () => {
  const input = props("remote://mac/worktrees/feature");
  const html = renderToStaticMarkup(createElement(WorkspaceSettingsSurface, input));
  expect(html).toContain("Delete worktree?");
  expect(manage).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith(
    expect.objectContaining({
      request: input.worktreeManagementRequest,
      onRemove: input.onRemoveWorktree,
    }),
  );
  expect(input.onRemoveWorktree).not.toHaveBeenCalled();
});
