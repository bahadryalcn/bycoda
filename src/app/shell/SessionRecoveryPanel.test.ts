// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRecoveryPanel } from "./SessionRecoveryPanel";
import { newSession } from "../../features/sessions/model/session";
import { newTab } from "../../features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";
import { captureSessionRecovery } from "../../features/workspace/model/sessionRecovery";
import type { RemoteRailSession } from "../../features/connections/model/remoteRailSessions";
import type { SessionRecovery } from "../../features/workspace/model/sessionRecovery";
import { markTurnInterrupted } from "../../features/sessions/model/inFlight";
import { getSession } from "../../features/sessions/data/sessionStore";
import { rememberRemoteSession } from "../../features/connections/model/connections";
import type { Session } from "../../features/sessions/model/session";

vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<typeof import("../../features/sessions/data/sessionStore")>()),
  getSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../shared/ui/Modal", () => ({
  Modal: ({
    children,
    title,
    onClose,
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) =>
    createElement(
      "div",
      { role: "dialog", "aria-label": title },
      children,
      createElement("button", { onClick: onClose }, "Close"),
    ),
}));
const locked = vi.hoisted(() => new Set<string>());
vi.mock("../../features/group-lock/hooks/useGroupLock", () => ({
  useVisibleProjects: (items: { cwd: string }[]) => items.filter((item) => !locked.has(item.cwd)),
}));
let root: Root;
let container: HTMLDivElement;
const sessions = ["alpha", "beta"].map((id) => ({
  ...newSession("codex", `/${id}`),
  id,
  title: id,
  busy: true,
}));
const recovery = captureSessionRecovery(
  null,
  collectWorkspaceSnapshot(
    sessions.map((s) => newTab(s.id)),
    sessions,
    "tab",
    "/alpha",
    new Map(),
  ),
  100,
)!;
const onOpen = vi.fn<(_ids: string[], _layout: boolean) => Promise<void>>();
const onClose = vi.fn();
const onRemove = vi.fn<(_ids: string[]) => Promise<void>>();
function render(
  remoteSessions: RemoteRailSession[] = [],
  value: SessionRecovery = recovery,
  localSessions: Session[] = sessions,
) {
  act(() =>
    root.render(
      createElement(SessionRecoveryPanel, {
        recovery: value,
        sessions: localSessions,
        remoteSessions,
        onOpen,
        onClose,
        onRemove,
      }),
    ),
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith(label),
  )!;
  await act(async () => {
    button.click();
  });
}
describe("session recovery navigation", () => {
  it("removes selected entries without opening or deleting conversations", async () => {
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Remove selected");
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(["alpha"]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("clears completed entries while preserving working entries", async () => {
    render([], recovery, [sessions[0], { ...sessions[1], busy: false, blocks: [] }]);
    await click("Clear completed");
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(["beta"]);
  });
  it("reports cleanup errors and leaves entries available to retry", async () => {
    onRemove.mockRejectedValueOnce(new Error("disk"));
    await click("Clear list");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    await click("Clear list");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  beforeEach(() => {
    localStorage.clear();
    locked.clear();
    onOpen.mockReset().mockResolvedValue(undefined);
    onClose.mockClear();
    onRemove.mockReset().mockResolvedValue(undefined);
    vi.mocked(getSession).mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it("opens every project without a list count limit and restores layout separately", async () => {
    await click("Open all");
    expect(onOpen).toHaveBeenLastCalledWith(["alpha", "beta"], false);
    await click("Restore previous layout");
    expect(onOpen).toHaveBeenLastCalledWith(["alpha", "beta"], true);
  });
  it("opens only selected conversations", async () => {
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("Open selected");
    expect(onOpen).toHaveBeenCalledWith(["alpha"], false);
  });
  it("preserves the list and enables retry after an open failure", async () => {
    onOpen.mockRejectedValueOnce(new Error("missing"));
    await click("Open all");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("preserved");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    await click("Open all");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not reveal or bulk-open locked projects", async () => {
    locked.add("/beta");
    render();
    expect(container.textContent).not.toContain("beta");
    await click("Open all");
    expect(onOpen).toHaveBeenCalledWith(["alpha"], false);
  });
  it("closing the dialog only acknowledges it", async () => {
    await click("Close");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("shows unfinished work by default while Open all includes completed sessions", async () => {
    const interrupted = markTurnInterrupted({ ...sessions[0], busy: false });
    const finished = {
      ...sessions[1],
      busy: false,
      blocks: [{ id: "done", role: "user" as const, text: "Task", durationMs: 10 }],
    };
    render([], recovery, [interrupted, finished]);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(container.querySelector("ul")?.textContent).toContain("Interrupted");
    expect(container.querySelector("ul")?.textContent).not.toContain("beta");
    await click("Open all");
    expect(onOpen).toHaveBeenLastCalledWith(["alpha", "beta"], false);
    await click("All sessions");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.querySelector("ul")?.textContent).toContain("Done");
  });
  it("counts errors and restores all tabs independently of search", async () => {
    const failed = {
      ...sessions[0],
      busy: false,
      blocks: [
        {
          id: "error",
          role: "system" as const,
          text: "Provider failure",
          notice: "error" as const,
        },
      ],
    };
    render([], recovery, [failed, sessions[1]]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("1 Failed");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search recovered sessions"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "alpha",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Restore previous layout");
    expect(onOpen).toHaveBeenLastCalledWith(["alpha", "beta"], true);
  });
  it("reads closed local conversations without reopening them to hide completed entries", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...sessions[1],
      busy: false,
      blocks: [{ id: "done", role: "user", text: "Finished task", durationMs: 10 }],
    });
    await act(async () => {
      render([], recovery, [sessions[0]]);
    });
    expect(getSession).toHaveBeenCalledWith("beta");
    expect(container.querySelector("ul")?.textContent).not.toContain("beta");
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("trusts only fresh host statuses with the matching machine and project identity", async () => {
    const remoteRecovery = {
      ...recovery,
      workspace: {
        ...recovery.workspace,
        sessions: [
          {
            ...recovery.workspace.sessions[0],
            cwd: "remote://machine-a/repo",
            remoteSessionId: "host-alpha",
          },
        ],
      },
    };
    const summary: RemoteRailSession = {
      project: "remote://machine-a/repo",
      fresh: false,
      session: {
        id: "host-alpha",
        title: "alpha",
        harness: "codex",
        projectId: "project",
        revision: 1,
        updatedAt: 100,
        status: "running",
      },
    };
    render([summary], remoteRecovery);
    expect(container.textContent).toContain("Status not verified");
    render([{ ...summary, fresh: true, project: "remote://machine-b/repo" }], remoteRecovery);
    expect(container.textContent).toContain("Status not verified");
    render([{ ...summary, fresh: true }], remoteRecovery);
    expect(container.textContent).not.toContain("Status not verified");
    expect(container.textContent).toContain("Working");
    await click("Open all");
    expect(onOpen).toHaveBeenCalledWith(["alpha"], false);
  });
  it("hides remote entries whose host session is already open and keeps the rest", () => {
    const stub = recovery.workspace.sessions[0];
    const stubs = [
      {
        ...stub,
        id: "r-open",
        cwd: "remote://machine-a/repo",
        remoteSessionId: "host-open",
      },
      {
        ...stub,
        id: "r-new",
        cwd: "remote://machine-a/repo",
        remoteSessionId: "host-new",
      },
    ];
    const remoteRecovery = {
      ...recovery,
      workspace: { ...recovery.workspace, sessions: stubs },
    };
    const shown = {
      ...newSession("codex", "remote://machine-a/repo"),
      id: "live-shell",
    };
    localStorage.clear();
    rememberRemoteSession(shown.id, "host-open");
    render([], remoteRecovery, [shown]);
    expect(container.textContent).toContain("1 previous sessions");
    render([], remoteRecovery, []);
    expect(container.textContent).toContain("2 previous sessions");
    localStorage.clear();
  });
});
