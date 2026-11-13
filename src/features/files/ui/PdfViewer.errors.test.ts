// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PdfViewer from "./PdfViewer";
import { PdfRasterBudget } from "../model/pdfRasterBudget";

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), pages: 2, load: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    render = () => Promise.resolve();
    cancel() {}
  },
  getDocument: () => pdf.load(),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function page(render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    streamTextContent: vi.fn(),
    render,
    cleanup: vi.fn(() => true),
  };
}

let host: HTMLDivElement;
let root: Root;
let observers: Array<{ target: Element; notify: (visible: boolean) => void }>;
const bytes = new Uint8Array([1]);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  pdf.getPage.mockReset();
  pdf.pages = 2;
  pdf.load.mockReset().mockImplementation(() => ({
    promise: Promise.resolve({ numPages: pdf.pages, getPage: pdf.getPage }),
    destroy: vi.fn(),
  }));
  observers = [];
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(632);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(632);
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
        if (this.options.rootMargin !== "100% 0px") return;
        const notify = (visible: boolean) =>
          this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never);
        observers.push({ target, notify });
        notify(true);
      }
      disconnect() {}
      unobserve() {}
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
});

const mount = () => act(async () => root.render(createElement(PdfViewer, { bytes })));
const frame = (number: number) => host.querySelector<HTMLElement>(`[data-page="${number}"]`)!;

it("shows an accessible page-loading error, then retries only that page", async () => {
  const first = page();
  const second = page();
  let firstFailed = false;
  pdf.getPage.mockImplementation(async (number: number) => {
    if (number === 1 && !firstFailed) {
      firstFailed = true;
      throw new Error("Page dictionary damaged");
    }
    return number === 1 ? first : second;
  });
  await mount();
  expect(frame(1).querySelector('[role="alert"]')?.textContent).toContain(
    "Page dictionary damaged",
  );
  expect(frame(2).querySelector("canvas")!.width).toBe(600);
  const retry = frame(1).querySelector<HTMLButtonElement>("button")!;
  expect(retry.textContent).toBe("Retry page 1");
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click());
  expect(frame(1).querySelector('[role="alert"]')).toBeNull();
  expect(first.render).toHaveBeenCalledTimes(1);
  expect(second.render).toHaveBeenCalledTimes(1);
  expect(pdf.getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 1]);
});

it("reports a decoder failure, frees its render buffer and preserves the other page on retry", async () => {
  const render = vi
    .fn()
    .mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("Decoder failed")),
      cancel: vi.fn(),
    }))
    .mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const first = page(render);
  const second = page();
  pdf.getPage.mockImplementation(async (number: number) => (number === 1 ? first : second));
  await mount();
  expect(frame(1).textContent).toContain("Couldn’t render page 1");
  expect(frame(1).textContent).toContain("Decoder failed");
  expect(render.mock.calls[0][0].canvas.width).toBe(0);
  expect(render.mock.calls[0][0].canvas.height).toBe(0);
  expect(frame(1).querySelector("canvas")!.width).toBe(0);
  const unaffected = frame(2).querySelector("canvas");
  await act(async () => frame(1).querySelector<HTMLButtonElement>("button")!.click());
  expect(frame(1).querySelector('[role="alert"]')).toBeNull();
  expect(frame(1).querySelector("canvas")!.width).toBe(600);
  expect(frame(2).querySelector("canvas")).toBe(unaffected);
  expect(second.render).toHaveBeenCalledTimes(1);
});

it("ignores rendering cancellation and stale render failures after leaving the viewport", async () => {
  const reserve = vi.spyOn(PdfRasterBudget.prototype, "reserve");
  const pending = deferred();
  const cancel = vi.fn();
  const first = page(vi.fn(() => ({ promise: pending.promise, cancel })));
  const cancelled = Object.assign(new Error("Cancelled"), { name: "RenderingCancelledException" });
  const second = page(vi.fn(() => ({ promise: Promise.reject(cancelled), cancel: vi.fn() })));
  pdf.getPage.mockImplementation(async (number: number) => (number === 1 ? first : second));
  await mount();
  const budget = reserve.mock.contexts[0];
  const pendingPixels = budget.pixels;
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => observers.find(({ target }) => target === frame(1))!.notify(false));
  expect(cancel).toHaveBeenCalledTimes(1);
  // Cancellation is asynchronous: preserve the render buffer until its task
  // settles so a replacement cannot spend the same raster allocation early.
  expect(first.render.mock.calls[0][0].canvas.width).toBeGreaterThan(0);
  expect(budget.pixels).toBe(pendingPixels);
  await act(async () => pending.reject(new Error("Late worker failure")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(first.render.mock.calls[0][0].canvas.width).toBe(0);
  expect(budget.pixels).toBe(0);
});

it("ignores stale getPage failures after unmount", async () => {
  const pending = deferred();
  pdf.getPage.mockImplementation(() => pending.promise);
  await mount();
  await act(async () => root.unmount());
  await act(async () => pending.reject(new Error("Late page failure")));
  expect(host.textContent).toBe("");
  root = createRoot(host);
});

it("bounds page scaffolding and releases visited PDF resources after render settles", async () => {
  pdf.pages = 1000;
  const first = page();
  pdf.getPage.mockResolvedValue(first);
  await mount();
  expect(host.querySelectorAll("[data-page]").length).toBeLessThan(10);
  expect(first.cleanup).not.toHaveBeenCalled();
  await act(async () => observers.find(({ target }) => target === frame(1))!.notify(false));
  expect(first.cleanup).toHaveBeenCalled();
});

it("recovers a parse error when the same mounted viewer receives repaired bytes", async () => {
  pdf.load.mockImplementationOnce(() => ({
    promise: Promise.reject(new Error("Invalid PDF structure")),
    destroy: vi.fn(),
  }));
  pdf.getPage.mockResolvedValue(page());
  await mount();
  expect(host.textContent).toContain("Invalid PDF structure");
  let finish!: (document: { numPages: number; getPage: typeof pdf.getPage }) => void;
  pdf.load.mockImplementationOnce(() => ({
    promise: new Promise((resolve) => {
      finish = resolve;
    }),
    destroy: vi.fn(),
  }));
  await act(async () => root.render(createElement(PdfViewer, { bytes: new Uint8Array([2]) })));
  expect(host.textContent).not.toContain("Invalid PDF structure");
  await vi.waitFor(() => expect(host.textContent).toContain("Loading PDF\u2026"));
  await act(async () => finish({ numPages: 2, getPage: pdf.getPage }));
  expect(host.querySelector('[aria-label="PDF preview"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("hides the retired PDF during replacement without losing page and scroll state", async () => {
  pdf.getPage.mockResolvedValue(page());
  await mount();
  const input = host.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
  const scroller = host.querySelector<HTMLElement>('[aria-label="PDF preview"]')!;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    nativeValue.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  scroller.scrollTop = 417;
  let finish!: (document: { numPages: number; getPage: typeof pdf.getPage }) => void;
  pdf.load.mockImplementationOnce(() => ({
    promise: new Promise((resolve) => {
      finish = resolve;
    }),
    destroy: vi.fn(),
  }));
  await act(async () => root.render(createElement(PdfViewer, { bytes: new Uint8Array([3]) })));
  expect(scroller.closest(".hidden")).not.toBeNull();
  expect(host.querySelector("[data-loading-card]")).not.toBeNull();
  await act(async () => finish({ numPages: 2, getPage: pdf.getPage }));
  expect(host.querySelector('[aria-label="Page number"]')).toBe(input);
  expect(input.value).toBe("2");
  expect(scroller.closest(".hidden")).toBeNull();
  expect(scroller.scrollTop).toBe(417);
});
