// @vitest-environment happy-dom
import { act, createElement, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clampVoicePanelSize, VoicePanelResize } from "./VoicePanelResize";
import { VoiceCompanionView, type VoiceCompanionViewProps } from "./VoiceCompanionView";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("keeps a chosen size inside the window and above the minimum", () => {
  expect(clampVoicePanelSize({ width: 480, height: 600 }, 300, 240)).toEqual({
    width: 284,
    height: 224,
  });
  expect(clampVoicePanelSize({ width: 2000, height: 50 }, 1280, 800)).toEqual({
    width: 1264,
    height: 260,
  });
  expect(clampVoicePanelSize({ width: 480, height: 600 }, 1280, 800)).toEqual({
    width: 480,
    height: 600,
  });
});

it("restores a stored size, resizes with the keyboard and resets on double-click", () => {
  localStorage.setItem("bycoda:voice-size", JSON.stringify({ width: 9999, height: 500 }));
  const panel = createRef<HTMLElement>();
  const onPosition = vi.fn();
  act(() =>
    root.render(
      createElement(
        "section",
        { ref: panel },
        createElement(VoicePanelResize, { panel, position: null, onPosition }),
      ),
    ),
  );
  const node = panel.current!;
  expect(node.hasAttribute("data-sized")).toBe(true);
  expect(node.style.getPropertyValue("--voice-panel-width")).toBe(`${window.innerWidth - 16}px`);
  expect(node.style.getPropertyValue("--voice-panel-height")).toBe("500px");

  vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 200, 400, 500) as DOMRect,
  );
  const grip = node.querySelector("button")!;
  act(() => grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  expect(node.style.getPropertyValue("--voice-panel-height")).toBe("524px");
  expect(JSON.parse(localStorage.getItem("bycoda:voice-size")!)).toEqual({
    width: 400,
    height: 524,
  });
  expect(onPosition).toHaveBeenCalled();

  act(() => grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(node.hasAttribute("data-sized")).toBe(false);
  expect(localStorage.getItem("bycoda:voice-size")).toBeNull();
});

const viewProps = (panel: RefObject<HTMLElement | null>, noop = () => {}) =>
  ({
    compact: false,
    status: "live",
    handle: null,
    visual: "orb",
    visualState: "listening",
    working: false,
    audioLevel: { current: 0 },
    title: "Arif",
    scopeTitle: "Global",
    summary: "",
    muted: false,
    speakerMuted: false,
    manual: false,
    statusText: "Listening",
    sessionStatusText: "",
    startDisabled: false,
    privacy: "",
    pushHint: "",
    workspace: true,
    globalScope: true,
    canDetach: false,
    toolActivities: [],
    chatTurns: [{ id: "1", role: "assistant", text: "Hangi klasör?" }],
    error: "",
    actionableError: false,
    liveText: "",
    toggleRef: createRef(),
    sessionPicker: null,
    choice: createElement("form", { id: "question" }),
    jobReview: null,
    recovery: null,
    resize: createElement("button", { id: "grip" }),
    panel,
    sideKey: "q1",
    onScopeChange: noop,
    onFloat: noop,
    onStopWaiting: noop,
    onStopWork: noop,
    onStart: noop,
    onClose: noop,
    onDismiss: noop,
    onToggleCompact: noop,
    onToggleMute: noop,
    onToggleSpeaker: noop,
    onSilence: noop,
    onFinish: noop,
    onManualChange: noop,
  }) as VoiceCompanionViewProps;

async function renderWithQuestion(rect: DOMRect) {
  const panel = createRef<HTMLElement>();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === "SECTION" ? rect : new DOMRect();
  });
  act(() =>
    root.render(
      createElement("section", { ref: panel }, createElement(VoiceCompanionView, viewProps(panel))),
    ),
  );
  await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
}

it("opens a question in its own panel beside the companion, keeping the transcript", async () => {
  window.innerWidth = 1280;
  window.innerHeight = 800;
  await renderWithQuestion(new DOMRect(16, 300, 360, 484));
  const side = host.querySelector("aside")!;
  expect(side.dataset.side).toBe("right");
  expect(side.style.left).toBe("384px");
  expect(side.querySelector("#question")).not.toBeNull();
  expect(host.querySelector('[role="list"]')?.contains(side)).toBe(false);
  expect(host.querySelector("header #grip")).not.toBeNull();
});

it("keeps the question inside the companion when the window has no room beside or above it", async () => {
  window.innerWidth = 400;
  window.innerHeight = 600;
  await renderWithQuestion(new DOMRect(16, 20, 360, 570));
  expect(host.querySelector("aside")).toBeNull();
  expect(host.querySelector("#question")).not.toBeNull();
});

function pointer(type: string, init: { clientX: number; clientY: number }) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, ...init });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

it("keeps the growth direction chosen at grab time while resizing", () => {
  window.innerWidth = 1280;
  window.innerHeight = 800;
  Element.prototype.setPointerCapture = vi.fn();
  const panel = createRef<HTMLElement>();
  const render = (position: { x: number; y: number } | null) =>
    act(() =>
      root.render(
        createElement(
          "section",
          { ref: panel },
          createElement(VoicePanelResize, { panel, position, onPosition: vi.fn() }),
        ),
      ),
    );
  render(null);
  const node = panel.current!;
  const rect = vi
    .spyOn(node, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(20, 200, 600, 400) as DOMRect);
  render({ x: 20, y: 200 });
  const grip = node.querySelector("button")!;
  act(() => grip.dispatchEvent(pointer("pointerdown", { clientX: 600, clientY: 200 })));
  // The grown panel's centre crosses the window midline, which re-evaluates the side
  // on every position update; the active gesture must not flip direction.
  rect.mockReturnValue(new DOMRect(400, 200, 1000, 400) as DOMRect);
  render({ x: 400, y: 200 });
  act(() => grip.dispatchEvent(pointer("pointermove", { clientX: 620, clientY: 200 })));
  expect(node.style.getPropertyValue("--voice-panel-width")).toBe("620px");
});

function renderResizablePanel() {
  window.innerWidth = 1280;
  window.innerHeight = 800;
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  const panel = createRef<HTMLElement>();
  const onPosition = vi.fn();
  act(() =>
    root.render(
      createElement(
        "section",
        { ref: panel },
        createElement(VoicePanelResize, { panel, position: null, onPosition }),
      ),
    ),
  );
  const node = panel.current!;
  vi.spyOn(node, "getBoundingClientRect").mockImplementation(
    () =>
      new DOMRect(
        Number.parseFloat(node.style.left) || 300,
        Number.parseFloat(node.style.top) || 250,
        Number.parseFloat(node.style.getPropertyValue("--voice-panel-width")) || 400,
        Number.parseFloat(node.style.getPropertyValue("--voice-panel-height")) || 300,
      ) as DOMRect,
  );
  return { node, onPosition };
}

it.each([
  ["n", 300, 280, 400, 270],
  ["s", 300, 250, 400, 330],
  ["e", 300, 250, 440, 300],
  ["w", 340, 250, 360, 300],
  ["ne", 300, 280, 440, 270],
  ["nw", 340, 280, 360, 270],
  ["se", 300, 250, 440, 330],
  ["sw", 340, 250, 360, 330],
])("resizes from %s while keeping the opposite edges fixed", (direction, x, y, width, height) => {
  const { node, onPosition } = renderResizablePanel();
  const handle = node.querySelector<HTMLElement>(`[data-resize-direction="${direction}"]`);
  expect(handle).not.toBeNull();
  act(() => handle!.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })));
  act(() => handle!.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 30 })));
  expect(node.getBoundingClientRect()).toMatchObject({ x, y, width, height });
  act(() => handle!.dispatchEvent(pointer("pointerup", { clientX: 40, clientY: 30 })));
  expect(onPosition).toHaveBeenLastCalledWith({ x, y });
  expect(JSON.parse(localStorage.getItem("bycoda:voice-size")!)).toEqual({ width, height });
  expect(JSON.parse(localStorage.getItem("bycoda:voice-position")!)).toEqual({ x, y });
});

it("limits edge growth at the viewport without moving the opposite edges", () => {
  const { node } = renderResizablePanel();
  const handle = node.querySelector<HTMLElement>('[data-resize-direction="nw"]');
  expect(handle).not.toBeNull();
  act(() => handle!.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })));
  act(() => handle!.dispatchEvent(pointer("pointermove", { clientX: -2000, clientY: -2000 })));
  expect(node.getBoundingClientRect()).toMatchObject({
    x: 8,
    y: 8,
    right: 700,
    bottom: 550,
  });
});

it("preserves automatic height when only a side edge is dragged", () => {
  const { node } = renderResizablePanel();
  node.style.setProperty("--voice-panel-height", "190px");
  const handle = node.querySelector<HTMLElement>('[data-resize-direction="e"]')!;
  act(() => handle.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })));
  act(() => handle.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 30 })));
  expect(node.getBoundingClientRect()).toMatchObject({ x: 300, y: 250, width: 440, height: 190 });
});

it("ignores secondary buttons and unrelated pointers during edge resizing", () => {
  const { node, onPosition } = renderResizablePanel();
  const handle = node.querySelector<HTMLElement>('[data-resize-direction="e"]');
  expect(handle).not.toBeNull();
  act(() => handle!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 })));
  act(() => handle!.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 30 })));
  expect(node.hasAttribute("data-sized")).toBe(false);
  act(() => handle!.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })));
  const otherPointer = new MouseEvent("pointermove", { bubbles: true, clientX: 400, clientY: 300 });
  Object.defineProperty(otherPointer, "pointerId", { value: 2 });
  act(() => handle!.dispatchEvent(otherPointer));
  expect(node.hasAttribute("data-sized")).toBe(false);
  expect(onPosition).not.toHaveBeenCalled();
});

it.each(["pointercancel", "lostpointercapture"])(
  "saves the last size on %s and ends the gesture",
  (event) => {
    const { node, onPosition } = renderResizablePanel();
    const handle = node.querySelector<HTMLElement>('[data-resize-direction="se"]')!;
    act(() => handle.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })));
    act(() => handle.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 30 })));
    act(() => handle.dispatchEvent(pointer(event, { clientX: 40, clientY: 30 })));
    expect(onPosition).toHaveBeenLastCalledWith({ x: 300, y: 250 });
    expect(JSON.parse(localStorage.getItem("bycoda:voice-size")!)).toEqual({
      width: 440,
      height: 330,
    });
    act(() => handle.dispatchEvent(pointer("pointermove", { clientX: 80, clientY: 60 })));
    expect(node.getBoundingClientRect()).toMatchObject({ width: 440, height: 330 });
  },
);
