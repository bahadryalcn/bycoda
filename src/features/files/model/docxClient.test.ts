import { afterEach, expect, it, vi } from "vitest";
import { loadDocx } from "./docxClient";
import {
  checkDocxExpansion,
  checkDocxHtml,
  MAX_DOCX_ELEMENTS,
  MAX_DOCX_EXPANDED_BYTES,
  MAX_DOCX_HTML_CHARACTERS,
} from "./docxPreview";

const worker = () =>
  ({
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  }) as unknown as Worker;
afterEach(() => vi.useRealTimers());

it("terminates replaced document conversion without detaching shared bytes or accepting a stale result", async () => {
  const instance = worker();
  const controller = new AbortController();
  const bytes = new Uint8Array([1, 2, 3]);
  const pending = loadDocx(bytes, controller.signal, () => instance);
  const reply = instance.onmessage!;
  const sent = vi.mocked(instance.postMessage).mock.calls[0][0] as Uint8Array;
  expect(sent.buffer).not.toBe(bytes.buffer);
  controller.abort();
  reply.call(instance, { data: { ok: true, html: "<p>old document</p>" } } as MessageEvent);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(instance.terminate).toHaveBeenCalledOnce();
  expect([...bytes]).toEqual([1, 2, 3]);
});

it("enforces a conversion deadline and releases worker listeners", async () => {
  vi.useFakeTimers();
  const instance = worker();
  const pending = loadDocx(new Uint8Array(), new AbortController().signal, () => instance, 100);
  const rejection = expect(pending).rejects.toThrow("exceeded 15 seconds");
  await vi.advanceTimersByTimeAsync(100);
  await rejection;
  expect(instance.terminate).toHaveBeenCalledOnce();
  expect(instance.onmessage).toBeNull();
  expect(instance.onerror).toBeNull();
});

it("rejects expanded HTML/node limits before sanitizer insertion and returns safe-sized complete conversion", async () => {
  expect(() => checkDocxHtml("a".repeat(MAX_DOCX_HTML_CHARACTERS + 1))).toThrow("too large");
  expect(() => checkDocxHtml("<section>text</section>".repeat(MAX_DOCX_ELEMENTS + 1))).toThrow(
    "too large",
  );
  const instance = worker();
  const pending = loadDocx(new Uint8Array(), new AbortController().signal, () => instance);
  instance.onmessage!({ data: { ok: true, html: "<h1>Title</h1><p>Text</p>" } } as MessageEvent);
  await expect(pending).resolves.toBe("<h1>Title</h1><p>Text</p>");
  expect(instance.terminate).toHaveBeenCalledOnce();
});

it("preflights highly expanded or malformed ZIP directories before conversion", () => {
  expect(() => checkDocxExpansion(new Uint8Array([1]))).toThrow("not a readable DOCX");
  const bytes = new Uint8Array(46 + 22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint32(24, MAX_DOCX_EXPANDED_BYTES + 1, true);
  view.setUint32(46, 0x06054b50, true);
  view.setUint16(46 + 10, 1, true);
  view.setUint32(46 + 12, 46, true);
  expect(() => checkDocxExpansion(bytes)).toThrow("too large");
  view.setUint32(24, 100, true);
  expect(() => checkDocxExpansion(bytes)).not.toThrow();
  view.setUint32(46 + 16, 67, true);
  expect(() => checkDocxExpansion(bytes)).toThrow("too large");
});
