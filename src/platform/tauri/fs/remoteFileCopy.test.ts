import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_COPY_CHUNK_BYTES,
  REMOTE_COPY_PREFETCH,
  REMOTE_COPY_RETRY_DELAYS_MS,
  downloadRemoteChunks,
  retryTransient,
  type RemoteChunk,
} from "./remoteFileCopy";

const MB = REMOTE_COPY_CHUNK_BYTES;
const noDelay = (_ms?: number) => Promise.resolve();
const transient = (error: unknown) => error instanceof Error && error.message === "link down";
const answer = (offset: number, length: number): RemoteChunk => ({
  data: `${offset}:${length}`,
  offset,
  length,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("retryTransient", () => {
  it("asks again after a transient failure with bounded backoff", async () => {
    const delay = vi.fn(noDelay);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("link down"))
      .mockRejectedValueOnce(new Error("link down"))
      .mockResolvedValue("ok");
    await expect(retryTransient(operation, { isTransient: transient, delay })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual(REMOTE_COPY_RETRY_DELAYS_MS.slice(0, 2));
  });

  it("throws the last transient failure once the retries are spent", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("link down"));
    await expect(
      retryTransient(operation, { isTransient: transient, delay: noDelay }),
    ).rejects.toThrow("link down");
    expect(operation).toHaveBeenCalledTimes(REMOTE_COPY_RETRY_DELAYS_MS.length + 1);
  });

  it("does not repeat a failure that is not transient", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("The file changed while downloading."));
    await expect(
      retryTransient(operation, { isTransient: transient, delay: noDelay }),
    ).rejects.toThrow("changed");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rejects at once when cancelled during the wait or during the request", async () => {
    const waiting = new AbortController();
    const operation = vi.fn().mockRejectedValue(new Error("link down"));
    const pending = retryTransient(operation, {
      signal: waiting.signal,
      isTransient: transient,
      delay: (_ms, signal) =>
        new Promise<void>((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))),
        ),
    });
    await Promise.resolve();
    waiting.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const running = new AbortController();
    const never = deferred<string>();
    const inFlight = retryTransient(() => never.promise, {
      signal: running.signal,
      isTransient: transient,
    });
    running.abort();
    await expect(inFlight).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("downloadRemoteChunks", () => {
  it("appends every chunk in byte order and reports progress", async () => {
    const size = MB * 3 + 10;
    const appended: number[] = [];
    const progress: number[] = [];
    await downloadRemoteChunks({
      size,
      read: (offset, length) => Promise.resolve(answer(offset, length)),
      append: (offset) => {
        appended.push(offset);
        return Promise.resolve();
      },
      isTransient: transient,
      onProgress: (received, total) => {
        expect(total).toBe(size);
        progress.push(received);
      },
    });
    expect(appended).toEqual([0, MB, MB * 2, MB * 3]);
    expect(progress).toEqual([0, MB, MB * 2, MB * 3, size]);
  });

  it("keeps later reads in flight while an earlier chunk is written, never beyond the window", async () => {
    const size = MB * 8;
    let inFlight = 0;
    let peak = 0;
    const write = deferred<void>();
    const started: number[] = [];
    const download = downloadRemoteChunks({
      size,
      read: async (offset, length) => {
        started.push(offset);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
        return answer(offset, length);
      },
      append: (offset) => (offset === 0 ? write.promise : Promise.resolve()),
      isTransient: transient,
    });
    await vi.waitFor(() => expect(started.length).toBe(REMOTE_COPY_PREFETCH + 1));
    // The first chunk is still being written, yet the next ones were already requested.
    expect(started).toEqual([0, MB, MB * 2]);
    write.resolve();
    await download;
    expect(started).toEqual(Array.from({ length: 8 }, (_, index) => index * MB));
    expect(peak).toBeLessThanOrEqual(REMOTE_COPY_PREFETCH + 1);
  });

  it("retries a failed chunk at its own offset and does not restart the file", async () => {
    const size = MB * 2;
    const reads: number[] = [];
    let failed = false;
    const appended: number[] = [];
    await downloadRemoteChunks({
      size,
      delay: noDelay,
      read: (offset, length) => {
        reads.push(offset);
        if (offset === MB && !failed) {
          failed = true;
          return Promise.reject(new Error("link down"));
        }
        return Promise.resolve(answer(offset, length));
      },
      append: (offset) => {
        appended.push(offset);
        return Promise.resolve();
      },
      isTransient: transient,
    });
    expect(reads.filter((offset) => offset === 0)).toHaveLength(1);
    expect(reads.filter((offset) => offset === MB)).toHaveLength(2);
    expect(appended).toEqual([0, MB]);
  });

  it("stops at a changed file without retrying and without an unhandled prefetch rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const reads: number[] = [];
    const appended: number[] = [];
    await expect(
      downloadRemoteChunks({
        size: MB * 4,
        delay: noDelay,
        read: (offset, length) => {
          reads.push(offset);
          return offset >= MB
            ? Promise.reject(new Error("The file changed while downloading. Try again."))
            : Promise.resolve(answer(offset, length));
        },
        append: (offset) => {
          appended.push(offset);
          return Promise.resolve();
        },
        isTransient: transient,
      }),
    ).rejects.toThrow("changed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(appended).toEqual([0]);
    expect(reads.filter((offset) => offset === MB)).toHaveLength(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("rejects an out-of-order or oversized chunk instead of appending it", async () => {
    const append = vi.fn(() => Promise.resolve());
    await expect(
      downloadRemoteChunks({
        size: 10,
        read: () => Promise.resolve({ data: "x", offset: 0, length: 11 }),
        append,
        isTransient: transient,
      }),
    ).rejects.toThrow("invalid file chunk");
    await expect(
      downloadRemoteChunks({
        size: 10,
        read: () => Promise.resolve({ data: "x", offset: 5, length: 5 }),
        append,
        isTransient: transient,
      }),
    ).rejects.toThrow("invalid file chunk");
    expect(append).not.toHaveBeenCalled();
  });

  it("continues from the received length after a short chunk, discarding stale prefetched reads", async () => {
    const size = MB * 2;
    const appended: number[] = [];
    await downloadRemoteChunks({
      size,
      read: (offset, length) =>
        Promise.resolve(offset === 0 ? answer(0, length - 100) : answer(offset, length)),
      append: (offset) => {
        appended.push(offset);
        return Promise.resolve();
      },
      isTransient: transient,
    });
    expect(appended[0]).toBe(0);
    expect(appended[1]).toBe(MB - 100);
    expect(appended.at(-1)).toBeLessThan(size);
  });

  it("cancels immediately while a chunk request is slow and ignores its late answer", async () => {
    const control = new AbortController();
    const slow = deferred<RemoteChunk>();
    const append = vi.fn(() => Promise.resolve());
    const download = downloadRemoteChunks({
      size: MB,
      signal: control.signal,
      read: () => slow.promise,
      append,
      isTransient: transient,
    });
    await Promise.resolve();
    control.abort();
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    slow.resolve(answer(0, MB));
    await Promise.resolve();
    expect(append).not.toHaveBeenCalled();
  });

  it("does not start reading when it was cancelled beforehand", async () => {
    const control = new AbortController();
    control.abort();
    const read = vi.fn();
    await expect(
      downloadRemoteChunks({
        size: MB,
        signal: control.signal,
        read,
        append: vi.fn(),
        isTransient: transient,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
  });

  it("stops retries of reads still in flight once the download has failed", async () => {
    const reads: number[] = [];
    await expect(
      downloadRemoteChunks({
        size: MB * 3,
        delay: (_ms, signal) =>
          new Promise<void>((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))),
          ),
        read: (offset, length) => {
          reads.push(offset);
          return offset === 0
            ? Promise.resolve(answer(offset, length))
            : Promise.reject(new Error("link down"));
        },
        append: () => Promise.reject(new Error("disk full")),
        isTransient: transient,
      }),
    ).rejects.toThrow("disk full");
    const settled = reads.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(reads).toHaveLength(settled);
  });
});
