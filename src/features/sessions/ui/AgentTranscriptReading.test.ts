// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { READING_ENTER_PX } from "./composerReading";

let container: HTMLDivElement;
let root: Root;
let observers: Array<{ targets: Element[]; resize: (entries?: unknown[]) => void }>;

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets: Element[] = [];
      constructor(readonly resize: (entries?: unknown[]) => void) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve() {}
      disconnect() {
        this.targets = [];
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount(onReadingChange: (reading: boolean) => void) {
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [{ id: "user", role: "user", text: "Keep working" }],
        busy: true,
        onReadingChange,
      }),
    ),
  );
  const scroller = container.querySelector<HTMLDivElement>(".agent-transcript")!;
  const geometry = { height: 3000, viewport: 400, top: 0 };
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => geometry.height },
    clientHeight: { get: () => geometry.viewport },
    scrollTop: {
      get: () => geometry.top,
      set: (value: number) => {
        geometry.top = Math.max(0, Math.min(value, geometry.height - geometry.viewport));
      },
    },
  });
  const observer = observers.find((item) => item.targets.includes(scroller))!;
  act(() => observer.resize());
  return { scroller, geometry, observer };
}

describe("transcript reading intent for the composer", () => {
  it("starts only after the reader scrolled clearly away, not from growth or resize", () => {
    const changes: boolean[] = [];
    const { scroller, geometry, observer } = mount((reading) => changes.push(reading));
    expect(geometry.top).toBe(2600);
    // Content growth while following is not reading.
    geometry.height += 500;
    act(() => observer.resize());
    expect(changes.at(-1)).not.toBe(true);

    // A short wheel up inside the entry distance leaves following but not yet reading.
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 }));
      geometry.top -= 40;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(changes.at(-1)).not.toBe(true);

    // Scrolling on past the entry distance latches reading.
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 }));
      geometry.top -= 400;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(changes.at(-1)).toBe(true);
    expect(geometry.height - geometry.top - geometry.viewport).toBeGreaterThan(READING_ENTER_PX);
  });

  it("stays latched when the compact composer grows the viewport and clamps the position", () => {
    const changes: boolean[] = [];
    const { scroller, geometry, observer } = mount((reading) => changes.push(reading));
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -600 }));
      geometry.top -= 600;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(changes.at(-1)).toBe(true);
    const flips = changes.length;
    // Compacting gives the transcript more height; the distance to the end shrinks.
    geometry.viewport = 520;
    geometry.top = Math.min(geometry.top, geometry.height - geometry.viewport);
    act(() => observer.resize([{ target: scroller }]));
    act(() => scroller.dispatchEvent(new Event("scroll")));
    // Expanding again on focus restores the old viewport.
    geometry.viewport = 400;
    act(() => observer.resize([{ target: scroller }]));
    act(() => scroller.dispatchEvent(new Event("scroll")));
    expect(changes.length).toBe(flips);
    expect(changes.at(-1)).toBe(true);
  });

  it("clears when the reader returns to the end, including a wheel at the very end", () => {
    const changes: boolean[] = [];
    const { scroller, geometry, observer } = mount((reading) => changes.push(reading));
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -600 }));
      geometry.top -= 600;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(changes.at(-1)).toBe(true);
    // The compact composer left the position clamped at the very end without a scroll event.
    geometry.top = geometry.height - geometry.viewport;
    act(() => observer.resize([{ target: scroller }]));
    expect(changes.at(-1)).toBe(true);
    act(() => scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 80 })));
    expect(changes.at(-1)).toBe(false);
    // Following works again for new output.
    geometry.height += 300;
    act(() => observer.resize());
    expect(geometry.top).toBe(geometry.height - geometry.viewport);
  });
});
