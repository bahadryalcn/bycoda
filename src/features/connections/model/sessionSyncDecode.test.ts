import { afterEach, expect, it, vi } from "vitest";
import { decodeSessionSync } from "./sessionSyncDecode";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps malformed and inconsistent transfers out of the decoder", async () => {
  await expect(decodeSessionSync(["{}"], 3)).rejects.toThrow("length");
  await expect(decodeSessionSync(["{"], 1)).rejects.toThrow();
  await expect(decodeSessionSync([], 33 * 1024 * 1024)).rejects.toThrow("length");
});

it("moves a large transfer's join and parse to a disposable module worker", async () => {
  const terminate = vi.fn();
  const posted = vi.fn();
  class Decoder {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminate = terminate;
    postMessage(value: { pieces: string[]; length: number }) {
      posted(value);
      queueMicrotask(() =>
        this.onmessage?.({ data: { value: JSON.parse(value.pieces.join("")) } }),
      );
    }
  }
  vi.stubGlobal("Worker", Decoder);
  const payload = JSON.stringify({ kind: "unchanged", revision: 2, padding: "x".repeat(300_000) });
  const pieces = [payload.slice(0, 100_000), payload.slice(100_000)];
  expect(await decodeSessionSync(pieces, payload.length)).toMatchObject({
    kind: "unchanged",
    revision: 2,
  });
  expect(posted).toHaveBeenCalledWith({ pieces, length: payload.length });
  expect(terminate).toHaveBeenCalledOnce();
});
