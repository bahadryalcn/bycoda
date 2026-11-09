import { afterEach, expect, it, vi } from "vitest";
import { extractVoiceDocument, voiceDocumentKind } from "./voiceDocumentContext";

const { getDocument, page, destroy } = vi.hoisted(() => {
  const destroy = vi.fn(async () => undefined);
  const page = vi.fn();
  return { getDocument: vi.fn(), page, destroy };
});
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument,
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker.js" }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("recognizes supported document formats without treating legacy binaries as text", () => {
  expect(voiceDocumentKind("a.PDF", "")).toBe("pdf");
  expect(voiceDocumentKind("report.docx", "")).toBe("docx");
  expect(voiceDocumentKind("sheet.xlsx", "")).toBe("spreadsheet");
  expect(voiceDocumentKind("sheet.xls", "application/vnd.ms-excel")).toBeUndefined();
});

it("reads bounded PDF text pages, reports omissions and releases PDF resources", async () => {
  const cleanup = vi.fn();
  page.mockResolvedValue({
    getTextContent: async () => ({ items: [{ str: "real page words", hasEOL: true }] }),
    cleanup,
  });
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 30, getPage: page }),
    destroy,
  });
  const result = await extractVoiceDocument(new Uint8Array([37, 80, 68, 70]), "pdf");
  expect(result).toMatchObject({ coverage: "text-only", truncated: true, format: "pdf" });
  expect(result.text).toContain("real page words");
  expect(page).toHaveBeenCalledTimes(20);
  expect(cleanup).toHaveBeenCalledTimes(20);
  expect(destroy).toHaveBeenCalledOnce();
  expect(getDocument.mock.calls[0][0]).toMatchObject({
    disableFontFace: true,
    stopAtErrors: true,
  });
});

it("terminates office parsing workers after success and after timeout", async () => {
  const created: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    onmessageerror?: () => void;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      created.push(this);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const pending = extractVoiceDocument(new Uint8Array([1]), "docx");
  const value = {
    text: "hello",
    textLength: 5,
    truncated: false,
    format: "docx",
    coverage: "text-only",
  };
  created[0].onmessage?.({ data: { ok: true, result: value } });
  expect(await pending).toEqual(value);
  expect(created[0].terminate).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  const stalled = extractVoiceDocument(new Uint8Array([1]), "spreadsheet");
  const rejection = expect(stalled).rejects.toThrow("could not be extracted");
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;
  expect(created[1].terminate).toHaveBeenCalledOnce();
});
