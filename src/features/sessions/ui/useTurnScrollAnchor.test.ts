// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginResizeGesture } from "../../../shared/lib/resizeGesture";
import { useTurnScrollAnchor } from "./useTurnScrollAnchor";

let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let observed: Element[];
let root: Root;
let host: HTMLDivElement;
let turn: HTMLDivElement;
let fontSize: string;
let computed: ReturnType<typeof vi.spyOn>;

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

async function settleMutations() {
  // MutationObserver callbacks are delivered asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function Probe({ el }: { el: HTMLDivElement }) {
  useTurnScrollAnchor(el, true, { current: false }, () => {});
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  nextFrameId = 1;
  observed = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(readonly callback: unknown) {}
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  fontSize = "16px";
  computed = vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
    () =>
      ({
        fontFamily: "serif",
        fontSize,
        fontWeight: "400",
        lineHeight: "24px",
        letterSpacing: "0px",
      }) as unknown as CSSStyleDeclaration,
  );

  host = document.createElement("div");
  const inner = document.createElement("div");
  inner.setAttribute("data-transcript-content", "");
  turn = document.createElement("div");
  turn.className = "transcript-turn";
  inner.append(turn);
  host.append(inner);
  document.body.append(host);
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { el: host })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTurnScrollAnchor appearance checks", () => {
  it("checks the font at most once per frame for a burst of root mutations", async () => {
    const baseline = computed.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      document.documentElement.style.setProperty("--burst", String(i));
      document.documentElement.classList.toggle("theme-light", i % 2 === 0);
    }
    await settleMutations();
    expect(frames.size).toBe(1);
    expect(computed.mock.calls.length).toBe(baseline);

    flushFrames();
    expect(computed.mock.calls.length).toBe(baseline + 1);
  });

  it("still re-measures turns when the computed font changes", async () => {
    flushFrames();
    const observedBefore = observed.filter((node) => node === turn).length;

    fontSize = "20px";
    document.documentElement.classList.add("density-test");
    await settleMutations();
    flushFrames();

    expect(observed.filter((node) => node === turn).length).toBe(observedBefore + 1);
  });

  it("does not re-measure turns when the font is unchanged", async () => {
    const observedBefore = observed.filter((node) => node === turn).length;

    document.documentElement.classList.add("unrelated-class");
    await settleMutations();
    flushFrames();

    expect(observed.filter((node) => node === turn).length).toBe(observedBefore);
  });
});

describe("useTurnScrollAnchor width changes", () => {
  let callback: ResizeObserverCallback;
  const widthEntry = (width: number) =>
    ({
      target: turn,
      contentRect: new DOMRect(0, 0, width, 100),
      borderBoxSize: [{ inlineSize: width, blockSize: 100 }],
    }) as unknown as ResizeObserverEntry;
  const report = (width: number) => act(() => callback([widthEntry(width)], {} as ResizeObserver));
  const turnObservations = () => observed.filter((node) => node === turn).length;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe(target: Element) {
          observed.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe, { el: host })));
    report(500);
    expect(turn.style.contentVisibility).toBe("auto");
  });

  it("re-measures a contained turn at once when the width changes outside a resize", () => {
    const before = turnObservations();
    report(400);
    expect(turnObservations()).toBe(before + 1);
    expect(turn.style.contentVisibility).toBe("");
  });

  it("keeps turns contained through a live resize and re-measures them once at its end", () => {
    const before = turnObservations();
    const end = beginResizeGesture();
    report(450);
    report(400);
    report(350);
    expect(turnObservations()).toBe(before);
    expect(turn.style.contentVisibility).toBe("auto");
    expect(turn.style.containIntrinsicBlockSize).toBe("100px");

    act(() => end());
    expect(turnObservations()).toBe(before + 1);
    expect(turn.style.contentVisibility).toBe("");
  });

  it("does not read the computed font while a resize is live", async () => {
    flushFrames();
    const end = beginResizeGesture();
    const baseline = computed.mock.calls.length;
    fontSize = "20px";
    document.documentElement.classList.add("density-live");
    await settleMutations();
    flushFrames();
    expect(computed.mock.calls.length).toBe(baseline);

    const before = turnObservations();
    act(() => end());
    expect(computed.mock.calls.length).toBeGreaterThan(baseline);
    expect(turnObservations()).toBe(before + 1);
  });
});
