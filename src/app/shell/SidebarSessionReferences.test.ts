// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { localReferenceForSession } from "../../features/sessions/model/localSessionNavigation";
import { localSessionLinkFields } from "../../features/sessions/model/localSessionReference";
import { copyText } from "../../platform/tauri/clipboard";

vi.mock("../../features/sessions/model/localSessionNavigation", () => ({
  localReferenceForSession: vi.fn(),
}));
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
vi.mock("../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));

const locator = { kind: "native" as const, sourceStoreId: "store", sourceProfileId: "profile", sessionId: "target" };
let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(localReferenceForSession).mockReset().mockResolvedValue(locator);
  vi.mocked(copyText).mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  props = {
    cwd: "/workspace/project", open: true,
    sessions: [{ id: "target", cwd: "/workspace/project", harness: "codex", model: "", runtimeMode: "supervised", title: "Title [with] *format*", createdAt: 1, updatedAt: 1 }],
    busySessionIds: new Set(), approvalSessionIds: new Set(), activeSessionId: "target",
    status: "idle", pending: false, tab: "sessions", filesSearchOpen: false,
    onSelectSession: vi.fn(), onRenameSession: vi.fn(), onOpenFile: vi.fn(), onTabChange: vi.fn(), onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Sidebar, props)));
  const card = container.querySelector<HTMLElement>('[data-session-card="target"]')!;
  await act(async () => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function action(label: string) {
  const result = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => button.textContent?.includes(label));
  expect(result, label).toBeTruthy();
  return result!;
}

describe("Sidebar session references", () => {
  it.each(["Copy session link", "Copy Markdown reference"])("copies %s through the proven owner and retains existing ID copy", async (label) => {
    expect(action("Copy session ID")).toBeTruthy();
    await act(async () => action(label).click());
    const expected = localSessionLinkFields(locator, props.sessions[0].title);
    expect(copyText).toHaveBeenCalledExactlyOnceWith(label === "Copy session link" ? expected.link : expected.markdownReference);
    expect(action(label).textContent).toContain("Copied");
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("shows clipboard failure at the copy action and permits retry", async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await act(async () => action("Copy session link").click());
    expect(action("Copy session link").textContent).toContain("Clipboard unavailable");
    await act(async () => action("Copy session link").click());
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(action("Copy session link").textContent).toContain("Copied");
  });

  it("blocks duplicate copy while identity resolution is pending", async () => {
    let resolve!: (value: typeof locator) => void;
    vi.mocked(localReferenceForSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await act(async () => action("Copy session link").click());
    expect(action("Copy session link").disabled).toBe(true);
    expect(action("Copy Markdown reference").disabled).toBe(true);
    expect(copyText).not.toHaveBeenCalled();
    await act(async () => resolve(locator));
    expect(copyText).toHaveBeenCalledTimes(1);
  });
});
