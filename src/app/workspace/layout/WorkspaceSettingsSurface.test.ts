// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  WorkspaceSettingsSurface,
  type WorkspaceSettingsSurfaceProps,
} from "./WorkspaceSettingsSurface";

const { manage, remove, view } = vi.hoisted(() => ({
  manage: vi.fn(),
  remove: vi.fn(),
  view: vi.fn(),
}));
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
  Modal: ({
    children,
    className,
    title,
  }: {
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => createElement("div", { "data-modal": title, className }, children),
}));
vi.mock("../../../shared/i18n/git", () => ({ t: (key: string) => key, useLocale: () => "en" }));
vi.mock("../surfaces/lazySurfaces", () => ({
  SettingsView: (props: unknown) => {
    view(props);
    return null;
  },
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

function settingsProps(presentation?: "page" | "dialog"): WorkspaceSettingsSurfaceProps {
  return {
    ...props(),
    presentation,
    worktreeManagementRequest: null,
    settingsOpen: true,
    settingsSection: "skills",
    onCloseSettings: vi.fn(),
  } as unknown as WorkspaceSettingsSurfaceProps;
}

it("keeps the full-window page presentation by default, with its own chrome", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSettingsSurface, settingsProps()));
  expect(html).not.toContain("data-modal");
  const shown = view.mock.calls[0][0] as Record<string, unknown>;
  expect(shown.embedded).toBe(false);
  expect(shown.onToggleMaximize).toBeUndefined();
});

it("shows Settings in the shared Modal with maximize and no duplicate window chrome", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSettingsSurface, settingsProps("dialog")),
  );
  expect(html).toContain('data-modal="Settings"');
  expect(html).toContain("bycoda-settings-dialog");
  // Every page shares one dialog geometry; only maximize changes it.
  expect(html).toContain('data-settings-dialog-mode="standard"');
  const shown = view.mock.calls[0][0] as Record<string, unknown>;
  expect(shown.embedded).toBe(true);
  expect(shown.maximized).toBe(false);
  expect(typeof shown.onToggleMaximize).toBe("function");
});
