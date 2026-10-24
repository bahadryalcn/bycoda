// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadDocx } from "../model/docxClient";
import DocxViewer from "./DocxViewer";

vi.mock("../model/docxClient", () => ({ loadDocx: vi.fn() }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(loadDocx).mockImplementation(async (bytes) =>
    Array.from({ length: 201 }, (_, i) => `<p>Document ${bytes[0]} paragraph ${i}</p>`).join(""),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps all sanitized sections through StrictMode replay and cancels progressive insertion on replacement", async () => {
  const first = new Uint8Array([1]);
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(DocxViewer, { bytes: first }))),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("Document 1 paragraph 200"));
  expect(
    [...host.querySelector(".relative > div > div")!.childNodes].map((node) => node.textContent),
  ).toEqual(Array.from({ length: 201 }, (_, i) => `Document 1 paragraph ${i}`));
  const signals = vi.mocked(loadDocx).mock.calls.map((call) => call[1]);
  expect(signals[0].aborted).toBe(true);
  await act(async () =>
    root.render(
      createElement(StrictMode, null, createElement(DocxViewer, { bytes: new Uint8Array([2]) })),
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("Document 2 paragraph 200"));
  expect(host.textContent).not.toContain("Document 1");
  expect(
    [...host.querySelector(".relative > div > div")!.childNodes].map((node) => node.textContent),
  ).toEqual(Array.from({ length: 201 }, (_, i) => `Document 2 paragraph ${i}`));
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
