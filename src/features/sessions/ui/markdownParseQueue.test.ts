import { expect, it, vi } from "vitest";
import { MarkdownParseQueue } from "./markdownParseQueue";

function fixture() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
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

it("settles a stalled worker as failure and ignores its late result", () => {
  vi.useFakeTimers();
  try {
    const { queue, worker, complete } = fixture();
    const result = vi.fn(),
      error = vi.fn();
    const release = queue.subscribe("a", { result, error });
    queue.request("a", "large content");
    vi.advanceTimersByTime(15_000);
    expect(error).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    complete(["late content"]);
    expect(result).not.toHaveBeenCalled();
    release();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("isolates a slow parse: only that reply falls back, siblings continue in order on a fresh worker", () => {
  vi.useFakeTimers();
  try {
    const workers: ReturnType<typeof makeWorker>[] = [];
    const makeWorker = () => ({
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
    });
    const queue = new MarkdownParseQueue(() => {
      const worker = makeWorker();
      workers.push(worker);
      return worker;
    });
    const slow = { result: vi.fn(), error: vi.fn() },
      second = { result: vi.fn(), error: vi.fn() },
      third = { result: vi.fn(), error: vi.fn() };
    const releases = [
      queue.subscribe("slow", slow),
      queue.subscribe("second", second),
      queue.subscribe("third", third),
    ];
    queue.request("slow", "huge reply");
    queue.request("second", "second reply");
    queue.request("third", "third reply");
    const stalled = workers[0];
    expect(stalled.postMessage).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    expect(slow.error).toHaveBeenCalledOnce();
    expect(second.error).not.toHaveBeenCalled();
    expect(third.error).not.toHaveBeenCalled();
    expect(stalled.terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
    const fresh = workers[1];
    expect(fresh.postMessage).toHaveBeenCalledTimes(1);
    expect(fresh.postMessage.mock.calls[0][0].text).toBe("second reply");

    // A late result and a late error from the terminated worker change nothing.
    stalled.onmessage!({ data: { sequence: 1, blocks: ["late"] } } as MessageEvent);
    stalled.onerror!.call(stalled as unknown as Worker, {} as ErrorEvent);
    expect(slow.result).not.toHaveBeenCalled();
    expect(fresh.terminate).not.toHaveBeenCalled();

    fresh.onmessage!({
      data: { sequence: fresh.postMessage.mock.calls[0][0].sequence, blocks: ["second"] },
    } as MessageEvent);
    expect(second.result).toHaveBeenCalledWith("second reply", ["second"]);
    expect(fresh.postMessage).toHaveBeenCalledTimes(2);
    expect(fresh.postMessage.mock.calls[1][0].text).toBe("third reply");
    fresh.onmessage!({
      data: { sequence: fresh.postMessage.mock.calls[1][0].sequence, blocks: ["third"] },
    } as MessageEvent);
    expect(third.result).toHaveBeenCalledWith("third reply", ["third"]);

    // The slow reply stays on its bounded fallback without a retry loop; siblings still parse.
    queue.request("slow", "huge reply, still growing");
    expect(slow.error).toHaveBeenCalledTimes(2);
    expect(fresh.postMessage).toHaveBeenCalledTimes(2);
    queue.request("second", "second reply again");
    expect(fresh.postMessage).toHaveBeenCalledTimes(3);
    expect(second.error).not.toHaveBeenCalled();

    // A released slow reply can be parsed again when it remounts.
    releases[0]();
    const remount = { result: vi.fn(), error: vi.fn() };
    const releaseRemount = queue.subscribe("slow", remount);
    queue.request("slow", "huge reply");
    expect(remount.error).not.toHaveBeenCalled();

    releaseRemount();
    releases[1]();
    releases[2]();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("reports malformed completion instead of leaving a reply pending forever", () => {
  const { queue, worker } = fixture();
  const error = vi.fn();
  const release = queue.subscribe("a", { result: vi.fn(), error });
  queue.request("a", "large content");
  worker.onmessage!({
    data: { sequence: worker.postMessage.mock.calls[0][0].sequence },
  } as MessageEvent);
  expect(error).toHaveBeenCalledOnce();
  release();
});

it("retries a fresh worker after the failed reply has been unmounted", () => {
  const { queue, worker, complete } = fixture();
  const error = vi.fn();
  const release = queue.subscribe("failed", { result: vi.fn(), error });
  queue.request("failed", "first reply");
  worker.onerror!.call(worker as unknown as Worker, {} as ErrorEvent);
  expect(error).toHaveBeenCalledOnce();
  release();

  const result = vi.fn();
  const releaseNext = queue.subscribe("next", { result, error: vi.fn() });
  queue.request("next", "next reply");
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  complete(["next reply"]);
  expect(result).toHaveBeenCalledWith("next reply", ["next reply"]);
  releaseNext();
});
