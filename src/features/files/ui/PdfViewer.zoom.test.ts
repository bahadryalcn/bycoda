// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PdfViewer from "./PdfViewer";
import { rememberZoom } from "./documentZoom";

const pdf = vi.hoisted(() => ({ pages: new Map<number, ReturnType<typeof makePage>>() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    render = () => Promise.resolve();
    cancel() {}
  },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 100,
      getPage: async (number: number) => {
        if (!pdf.pages.has(number)) pdf.pages.set(number, makePage(number));
        return pdf.pages.get(number);
      },
    }),
    destroy: vi.fn(),
  }),
}));

function makePage(number: number) {
  const height = [500, 800, 1200][number % 3];
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: height * scale }),
    streamTextContent: vi.fn(),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    cleanup: vi.fn(),
  };
}

let host: HTMLDivElement;
let root: Root;
const frame = (number: number) => host.querySelector<HTMLElement>(`[data-page="${number}"]`)!;
const scroller = () => host.querySelector<HTMLElement>(".overflow-auto")!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id));
  rememberZoom("pdf", 1);
  pdf.pages.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(632);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(632);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function () {
    return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height || "800");
  });
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (options) {
    if (typeof options !== "object") return;
    if (options.top != null) this.scrollTop = options.top;
    if (options.left != null) this.scrollLeft = options.left;
    queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.dataset.page) {
      const width = Number.parseFloat(this.style.width);
      const height = Number.parseFloat(this.style.height);
      const top = Number.parseFloat(
        this.parentElement!.style.transform.slice("translateY(".length),
      );
      return new DOMRect(
        Math.max(0, (632 - width) / 2) - scroller().scrollLeft,
        top - scroller().scrollTop,
        width,
        height,
      );
    }
    return new DOMRect(0, 0, 632, 800);
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: IntersectionObserverCallback,
        private options: IntersectionObserverInit,
      ) {}
      observe(target: Element) {
        if (this.options.rootMargin === "100% 0px")
          this.callback(
            [{ target, isIntersecting: true } as IntersectionObserverEntry],
            this as never,
          );
      }
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rememberZoom("pdf", "fit");
});

async function mountAtPage(number: number) {
  await act(async () => root.render(createElement(PdfViewer, { bytes: new Uint8Array([1]) })));
  const input = host.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      String(number),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
}

it("keeps a deep mixed-height page point stable through toolbar zoom and fit", async () => {
  await mountAtPage(50);
  const before = frame(50).getBoundingClientRect();
  const fraction = (400 - before.top) / before.height;
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
  const zoomed = frame(50).getBoundingClientRect();
  expect(zoomed.top + fraction * zoomed.height).toBeCloseTo(400, 5);
  expect(host.querySelectorAll("[data-page]").length).toBeLessThan(10);
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Fit width")!
      .click(),
  );
  const fitted = frame(50).getBoundingClientRect();
  expect(fitted.top + fraction * fitted.height).toBeCloseTo(400, 5);
});

it("updates the complete virtual geometry during wheel zoom and rasterizes only after settle", async () => {
  await mountAtPage(50);
  const original = frame(50);
  const canvas = original.querySelector("canvas")!;
  const before = original.getBoundingClientRect();
  const fraction = (300 - before.top) / before.height;
  const render = pdf.pages.get(50)!.render;
  const calls = render.mock.calls.length;
  const bitmapWidth = canvas.width;
  const total = scroller().firstElementChild as HTMLElement;
  const height = Number.parseFloat(total.style.height);
  await act(async () => {
    // happy-dom's WheelEvent does not populate MouseEvent modifier fields.
    const wheel = Object.assign(new Event("wheel", { bubbles: true, cancelable: true }), {
      ctrlKey: true,
      deltaY: -150,
      deltaMode: 0,
      clientX: 316,
      clientY: 300,
    });
    scroller().dispatchEvent(wheel);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(frame(50)).toBe(original);
  expect(Number.parseFloat(total.style.height)).toBeGreaterThan(height);
  expect(render).toHaveBeenCalledTimes(calls);
  expect(canvas.width).toBe(bitmapWidth);
  const zoomed = frame(50).getBoundingClientRect();
  expect(zoomed.top + fraction * zoomed.height).toBeCloseTo(300, 5);
  const next = frame(51).getBoundingClientRect();
  expect(next.top - zoomed.bottom).toBe(12);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(render).toHaveBeenCalledTimes(calls + 1);
  expect(frame(50)).toBe(original);
  const settled = frame(50).getBoundingClientRect();
  expect(settled.top + fraction * settled.height).toBeCloseTo(300, 5);
});
