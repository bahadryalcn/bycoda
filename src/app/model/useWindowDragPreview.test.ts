// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowDragPreview } from "./useWindowDragPreview";
import type { WindowTabDragHover } from "./windowDragPreview";
import {
  getExternalPaneDrop,
  getExternalTitleTabDrop,
  clearWindowDragPreview,
} from "../../features/workspace/model/paneDrop";

const mocked = vi.hoisted(() => ({
  listener: undefined as ((event: { payload: any }) => void) | undefined,
  openIds: new Set<string>(),
  canReceive: true,
  receivePoints: [] as Array<{ x: number; y: number }>,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn((_event, callback) => {
      mocked.listener = callback;
      return Promise.resolve(vi.fn());
    }),
  }),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let pane: HTMLDivElement;
beforeEach(() => {
  mocked.openIds.clear();
  mocked.canReceive = true;
  mocked.receivePoints = [];
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  pane = document.createElement("div");
  pane.dataset.paneId = "target";
  container.append(pane);
  vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
  vi.spyOn(document, "elementFromPoint").mockReturnValue(pane);
  const host = document.createElement("div");
  container.append(host);
  root = createRoot(host);
  function Preview() {
    useWindowDragPreview(
      () => mocked.openIds,
      (x, y) => {
        mocked.receivePoints.push({ x, y });
        return mocked.canReceive;
      },
    );
    return null;
  }
  act(() => root.render(createElement(Preview)));
});
afterEach(() => {
  act(() => root.unmount());
  clearWindowDragPreview();
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function hover(revision: number, values: Partial<WindowTabDragHover> = {}) {
  act(() =>
    mocked.listener!({
      payload: {
        sourceWindowLabel: "secondary",
        sourceId: "source",
        dragId: "gesture",
        revision,
        x: 10,
        y: 150,
        ended: false,
        ...values,
      },
    }),
  );
}

describe("cross-window destination preview", () => {
  it("converts monitor logical points to receiving CSS points before preview and eligibility checks", () => {
    vi.stubGlobal("devicePixelRatio", 4);
    hover(1, { x: 400, y: 300, scaleFactor: 2 });
    expect(document.elementFromPoint).toHaveBeenLastCalledWith(200, 150);
    expect(mocked.receivePoints.at(-1)).toEqual({ x: 200, y: 150 });
    expect(getExternalPaneDrop()?.edge).toBe("center");

    vi.stubGlobal("devicePixelRatio", 1);
    hover(2, { x: 100, y: 75, scaleFactor: 2 });
    expect(document.elementFromPoint).toHaveBeenLastCalledWith(200, 150);
    expect(mocked.receivePoints.at(-1)).toEqual({ x: 200, y: 150 });
  });
  it("uses a file insertion marker only for a file drag over an editor strip", () => {
    const strip = document.createElement("div");
    strip.dataset.surfacePaneId = "target";
    const tab = document.createElement("div");
    tab.dataset.surfaceTabId = "target-file";
    strip.append(tab);
    pane.append(strip);
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 30));
    vi.mocked(document.elementFromPoint).mockReturnValue(tab);
    hover(1, { sourceId: "chat", x: 20, y: 15 });
    expect(getExternalPaneDrop()).toMatchObject({ overId: "target", edge: "center" });
    expect(getExternalPaneDrop()?.targetFileId).toBeUndefined();
    expect(getExternalPaneDrop()?.tabPosition).toBeUndefined();
    hover(2, { sourceId: "file:moving-file", sourceIds: ["moving-file"], x: 20, y: 15 });
    expect(getExternalPaneDrop()).toMatchObject({
      overId: "target",
      targetFileId: "target-file",
      tabPosition: "before",
    });
  });
  it("shows a blocked target for a duplicate pane and accepts unrelated conversations", () => {
    mocked.openIds.add("already-open");
    hover(1, { sourceIds: ["already-open", "other"] });
    expect(getExternalPaneDrop()).toMatchObject({ overId: "target", invalid: true });
    hover(2, { sourceIds: ["new-session"] });
    expect(getExternalPaneDrop()?.invalid).toBeFalsy();
  });

  it("blocks a destination panel already transferring to another window", () => {
    mocked.canReceive = false;
    hover(1);
    expect(getExternalPaneDrop()?.invalid).toBe(true);
    mocked.canReceive = true;
    hover(2);
    expect(getExternalPaneDrop()?.invalid).toBeFalsy();
  });

  it("never resurrects an ended gesture even if a late hover has a newer revision", () => {
    hover(3);
    hover(4, { ended: true });
    hover(5);
    expect(getExternalPaneDrop()).toBeNull();
    hover(6, { dragId: "next-gesture" });
    expect(getExternalPaneDrop()).not.toBeNull();
  });
  it("paints edge and center targets, ignores stale events and clears on end", () => {
    hover(10);
    expect(getExternalPaneDrop()).toMatchObject({ overId: "target", edge: "left" });
    hover(11, { x: 200 });
    expect(getExternalPaneDrop()?.edge).toBe("center");
    hover(10, { ended: true });
    expect(getExternalPaneDrop()).not.toBeNull();
    hover(12, { ended: true });
    expect(getExternalPaneDrop()).toBeNull();
  });

  it("shows a title insertion marker with exact before/after placement", () => {
    const strip = document.createElement("div");
    strip.dataset.titleTabStrip = "";
    const tab = document.createElement("div");
    tab.dataset.titleTabId = "target-tab";
    strip.append(tab);
    container.append(strip);
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 30));
    vi.mocked(document.elementFromPoint).mockReturnValue(tab);
    hover(20, { x: 20, y: 15 });
    expect(getExternalPaneDrop()).toBeNull();
    expect(getExternalTitleTabDrop()).toMatchObject({
      targetTabId: "target-tab",
      position: "before",
    });
    hover(21, { x: 80, y: 15 });
    expect(getExternalTitleTabDrop()?.position).toBe("after");
    hover(22, { ended: true });
    expect(getExternalTitleTabDrop()).toBeNull();
  });

  it("keeps stationary heartbeats visible and clears a crashed source", () => {
    hover(30);
    act(() => vi.advanceTimersByTime(1000));
    hover(31);
    act(() => vi.advanceTimersByTime(1000));
    expect(getExternalPaneDrop()).not.toBeNull();
    act(() => vi.advanceTimersByTime(801));
    expect(getExternalPaneDrop()).toBeNull();
  });
});
