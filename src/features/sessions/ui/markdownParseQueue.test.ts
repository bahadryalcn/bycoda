import { expect, it, vi } from "vitest";
import { MarkdownParseQueue } from "./markdownParseQueue";

function fixture() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as Worker["onmessage"],
    onerror: null as Worker["onerror"],
  };
  const queue = new MarkdownParseQueue(() => worker);
  const complete = (blocks: string[]) =>
    worker.onmessage!({
      data: { sequence: worker.postMessage.mock.calls.at(-1)![0].sequence, blocks },
    } as MessageEvent);
  return { queue, worker, complete };
}
it("coalesces stream bursts, preserves intermediate append progress, and serves independent replies", () => {
  const { queue, worker, complete } = fixture(),
    first = vi.fn(),
    second = vi.fn();
  const releaseA = queue.subscribe("a", { result: first, error: vi.fn() });
  const releaseB = queue.subscribe("b", { result: second, error: vi.fn() });
  queue.request("a", "one");
  queue.request("a", "one two");
  queue.request("a", "one two three");
  queue.request("b", "other");
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  complete(["one"]);
  expect(first).toHaveBeenCalledWith("one", ["one"]);
  expect(worker.postMessage.mock.calls[1][0].text).toBe("one two three");
  complete(["one two three"]);
  complete(["other"]);
  expect(second).toHaveBeenCalledWith("other", ["other"]);
  releaseA();
  expect(worker.terminate).not.toHaveBeenCalled();
  releaseB();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("rejects obsolete rewrites and releases the last worker on unmount", () => {
  const { queue, worker, complete } = fixture(),
    result = vi.fn();
  const release = queue.subscribe("a", { result, error: vi.fn() });
  queue.request("a", "old");
  queue.request("a", "replacement");
  complete(["old"]);
  expect(result).not.toHaveBeenCalled();
  complete(["replacement"]);
  expect(result).toHaveBeenCalledWith("replacement", ["replacement"]);
  release();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
