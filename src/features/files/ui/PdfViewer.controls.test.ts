// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import PdfViewer from "./PdfViewer";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }),
    }),
    destroy: vi.fn(),
  }),
}));

it("retains transient page text, commits/clamps on Enter and restores the current page on blur", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const observer = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  vi.stubGlobal("ResizeObserver", observer);
  vi.stubGlobal("IntersectionObserver", observer);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PdfViewer, { bytes: new Uint8Array([1]) })));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const type = async (value: string) => {
      await act(async () => {
        nativeValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("numeric");
    await type("");
    expect(input.value).toBe("");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(input.value).toBe("1");
    await type("2");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(input.value).toBe("2");
    await type("99");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(input.value).toBe("3");
    await type("-");
    expect(input.value).toBe("-");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(input.value).toBe("3");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
