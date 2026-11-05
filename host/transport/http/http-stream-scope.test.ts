import { getEventListeners } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { HttpStreamScope, readHttpBytes } from "./http-stream-scope";

afterEach(() => vi.useRealTimers());
const scope = () =>
  new HttpStreamScope(new AbortController().signal, {
    firstMs: 10,
    idleMs: 10,
    totalMs: 40,
    label: "Fixture",
  });

it("aborts the actual pending request and disposes a response arriving after deadline", async () => {
  vi.useFakeTimers();
  const owner = scope();
  let release!: (response: Response) => void;
  let signal!: AbortSignal;
  const pending = owner.request((original) => {
    signal = original;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  const failed = expect(pending).rejects.toThrow("first response timed out");
  await vi.advanceTimersByTimeAsync(11);
  await failed;
  expect(signal.aborted).toBe(true);
  const cancel = vi.fn();
  release(new Response(new ReadableStream({ cancel })));
  await Promise.resolve();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
  owner.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("healthy tiny chunks refresh one idle timer without extending total budget or retaining wait listeners", async () => {
  vi.useFakeTimers();
  const owner = scope();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  owner.body(
    new Response(
      new ReadableStream({
        start(value) {
          writer = value;
        },
        cancel,
      }),
    ),
  );
  for (let index = 0; index < 7; index++) {
    const next = owner.read();
    await vi.advanceTimersByTimeAsync(5);
    writer.enqueue(new Uint8Array([index]));
    expect((await next).value).toEqual(new Uint8Array([index]));
    expect(vi.getTimerCount()).toBe(2);
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(1);
  }
  const held = owner.read();
  const failed = expect(held).rejects.toThrow("total stream timed out");
  await vi.advanceTimersByTimeAsync(6);
  await failed;
  owner.close();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects oversized streamed bodies before retaining the next chunk and cancels original reader", async () => {
  const owner = scope();
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(writer) {
        writer.enqueue(new Uint8Array(8));
        writer.enqueue(new Uint8Array(8));
      },
      cancel,
    }),
  );
  await expect(readHttpBytes(owner, response, 10)).rejects.toThrow("exceeds byte limit");
  owner.close();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
  expect(owner.signal.aborted).toBe(true);
});
