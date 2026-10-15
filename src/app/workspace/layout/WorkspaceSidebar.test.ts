// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceSidebar, type WorkspaceSidebarProps } from "./WorkspaceSidebar";
import { useSidebarActions } from "./useSidebarActions";
import { useRecoveryControl } from "./useRecoveryControl";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("../../shell/Sidebar", () => ({
  Sidebar: (props: { onNew: () => void }) => {
    rendered(props);
    return createElement("button", { onClick: props.onNew }, "New session");
  },
}));

it("skips equivalent navigation objects but invokes the latest committed action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const events: number[] = [];
  const base = { cwd: "/p", gitCwd: "/p", sessions: [], notesEnabled: false };
  function Probe({ version, pending }: { version: number; pending?: string }) {
    const recoveryControl = useRecoveryControl({
      toolWindow: null,
      windowTransfer: null,
      recoveryCount: 1,
      setRecoveryOpen: () => {},
      clearRecoveredSessions: async () => {},
    });
    const actions = useSidebarActions({ onNew: () => events.push(version), onOpenNotes: () => {} });
    return createElement(WorkspaceSidebar, {
      ...base,
      ...actions,
      recoveryControl,
      workspaceNavigation: { pending: pending ? { project: pending } : null },
      tabVisitNav: { canBack: false, canForward: false },
      surfaceForward: { canForward: false },
    } as unknown as WorkspaceSidebarProps);
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    rendered.mockClear();
    await act(async () => root.render(createElement(Probe, { version: 1 })));
    expect(rendered).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(events).toEqual([1]);
    await act(async () => root.render(createElement(Probe, { version: 2, pending: "/p" })));
    expect(rendered).toHaveBeenCalledOnce();
    expect(rendered.mock.lastCall![0].workspaceSwitchPending).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("gives a stable delegate to an action key added after mount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const events: string[] = [];
  const seen: unknown[] = [];
  function Probe({ late }: { late?: boolean }) {
    const actions = useSidebarActions<{ onNew?: () => void }>(
      late ? { onNew: () => events.push("new") } : {},
    );
    seen.push(actions.onNew);
    return createElement("button", { onClick: () => actions.onNew?.() }, "go");
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe, {})));
    expect(seen.at(-1)).toBeUndefined();
    await act(async () => root.render(createElement(Probe, { late: true })));
    const first = seen.at(-1);
    expect(typeof first).toBe("function");
    await act(async () => host.querySelector("button")!.click());
    expect(events).toEqual(["new"]);
    await act(async () => root.render(createElement(Probe, { late: true })));
    expect(seen.at(-1)).toBe(first);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
