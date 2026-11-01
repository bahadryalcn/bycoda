import { describe, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn }));
import { useClosePaneActions, type ClosePaneActionDeps } from "./useClosePaneActions";
import { newTab, splitPane, leafIds, leaf } from "../../../features/workspace/model/layout";
import type { Session } from "../../../features/sessions/model/session";

function setup() {
  const active = newTab("active");
  const background = newTab("target");
  background.layout = splitPane(background.layout, "target", "right", "sibling");
  const tabsRef = { current: [active, background] };
  const deps: ClosePaneActionDeps = {
    activeTab: active,
    tabsRef,
    sessionsRef: {
      current: ["active", "target", "sibling"].map(
        (id) => ({ id, cwd: "/project", blocks: [] }) as unknown as Session,
      ),
    },
    activeTabIdRef: { current: active.id },
    movingTabIds: { current: new Set() },
    windowTransferPendingRef: { current: false },
    onCloseFile: vi.fn(),
    onCloseTab: vi.fn(),
    onClearTabSession: vi.fn(),
    persistSession: vi.fn(),
    refreshHistory: vi.fn(async () => undefined),
    sidebarCwd: "/project",
    tabCloseScope: "workspace",
    tabWorktreeOf: () => null,
    setTabs: (update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    },
    setComposerFocused: vi.fn(),
  };
  return { deps, active, background, ...useClosePaneActions(deps) };
}

describe("explicit voice pane closure", () => {
  it("closes the requested background session while retaining its sibling and active tab", () => {
    const { deps, active, background, onClosePane } = setup();
    onClosePane("target", background.id);
    expect(
      leafIds(deps.tabsRef.current.find((entry) => entry.id === background.id)!.layout),
    ).toEqual(["sibling"]);
    expect(deps.tabsRef.current.find((entry) => entry.id === active.id)).toBe(active);
    expect(deps.onCloseTab).not.toHaveBeenCalled();
    expect(deps.setComposerFocused).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(expect.objectContaining({ id: "target" }));
  });
  it("does not fall back to the active tab for a stale target tab", () => {
    const { deps, onClosePane } = setup();
    const before = deps.tabsRef.current;
    onClosePane("target", "retired-tab");
    expect(deps.tabsRef.current).toBe(before);
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
  it("retains movement guards for explicit targets", () => {
    const { deps, background, onClosePane } = setup();
    deps.movingTabIds.current.add(background.id);
    onClosePane("target", background.id);
    expect(leafIds(deps.tabsRef.current[1].layout)).toEqual(["target", "sibling"]);
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
  it("routes a final background pane through the existing tab close safeguards", () => {
    const { deps, background, onClosePane } = setup();
    background.layout = leaf("target");
    onClosePane("target", background.id);
    expect(deps.onCloseTab).toHaveBeenCalledWith(background.id);
    expect(deps.onClearTabSession).not.toHaveBeenCalled();
  });
});
