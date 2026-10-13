import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSpreadsheet } from "./spreadsheetClient";

function fakeWorker() {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  } as unknown as Worker;
}
afterEach(() => vi.useRealTimers());
describe("spreadsheet worker lifecycle", () => {
  it("terminates ongoing work on file change/unmount cancellation", async () => {
    const worker = fakeWorker();
    const controller = new AbortController();
    const pending = loadSpreadsheet(new Uint8Array([1]), controller.signal, () => worker);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });
  it("terminates a blocked parse at the deadline", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    const pending = loadSpreadsheet(
      new Uint8Array([1]),
      new AbortController().signal,
      () => worker,
      15_000,
    );
    const rejected = expect(pending).rejects.toThrow("exceeded 15 seconds");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("transfers a copy and releases the worker after success", async () => {
    const worker = fakeWorker();
    const bytes = new Uint8Array([1, 2]);
    const pending = loadSpreadsheet(bytes, new AbortController().signal, () => worker);
    const sent = vi.mocked(worker.postMessage).mock.calls[0][0] as Uint8Array;
    expect(sent.buffer).not.toBe(bytes.buffer);
    worker.onmessage!({
      data: { ok: true, book: { sheets: [], omittedSheets: 0 } },
    } as MessageEvent);
    await expect(pending).resolves.toEqual({ sheets: [], omittedSheets: 0 });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
