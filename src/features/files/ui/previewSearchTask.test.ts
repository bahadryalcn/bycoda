import { afterEach, expect, it, vi } from "vitest";
import { startPreviewSearch, PREVIEW_REGEX_DEADLINE_MS } from "./previewSearchTask";

const options = { regexp: true, wholeWord: false, caseSensitive: false };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("terminates cancelled work and ignores a late worker response", async () => {
  class ControlledWorker {
    static instance: ControlledWorker;
    onmessage?: (event: { data: unknown }) => void;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      ControlledWorker.instance = this;
    }
  }
  vi.stubGlobal("Worker", ControlledWorker);
  const task = startPreviewSearch(["text"], ".*", options);
  task.cancel();
  ControlledWorker.instance.onmessage?.({
    data: { matches: [{ run: 0, from: 0, to: 4 }], invalid: false, capped: false },
  });
  expect(await task.result).toMatchObject({ matches: [], timedOut: true });
  expect(ControlledWorker.instance.terminate).toHaveBeenCalledOnce();
});

it("terminates a worker that never responds at the deadline", async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      terminate = terminate;
      postMessage() {}
    },
  );
  const task = startPreviewSearch(["text"], ".*", options);
  await vi.advanceTimersByTimeAsync(PREVIEW_REGEX_DEADLINE_MS);
  expect(await task.result).toMatchObject({ timedOut: true });
  expect(terminate).toHaveBeenCalledOnce();
});

it("fails closed when workers are unavailable instead of evaluating on the UI thread", async () => {
  vi.stubGlobal("Worker", undefined);
  expect(await startPreviewSearch(["a".repeat(30) + "!"], "(a+)+$", options).result).toMatchObject({
    timedOut: true,
  });
});
