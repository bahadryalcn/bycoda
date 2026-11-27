import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  body,
  boundRequestReceive,
  MAX_BODY,
  REQUEST_RECEIVE_TIMEOUT_MS,
  UNAUTHENTICATED_RECEIVE_TIMEOUT_MS,
} from "./support";

// Mock upload stream: yields pre-built chunks and records when it is released, so tests can
// assert cleanup without any socket or timer.
function mockUpload(chunks: Buffer[]) {
  const state = { released: false };
  async function* stream() {
    try {
      for (const chunk of chunks) yield chunk;
    } finally {
      state.released = true;
    }
  }
  return { request: stream() as unknown as IncomingMessage, state };
}

// Builds a JSON object whose serialized size is exactly `size` bytes, split into fixed chunks
// the way a slow remote upload would arrive.
function jsonUpload(size: number, chunkSize: number): Buffer[] {
  const head = Buffer.from('{"d":"');
  const tail = Buffer.from('"}');
  const payload = Buffer.alloc(size - head.length - tail.length, "a");
  const whole = Buffer.concat([head, payload, tail]);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < whole.length; offset += chunkSize) {
    chunks.push(whole.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

describe("Host HTTP body reading", () => {
  it("accepts a legitimate upload that arrives in many chunks up to MAX_BODY", async () => {
    const { request, state } = mockUpload(jsonUpload(MAX_BODY, 1024 * 1024));

    const value = await body(request);

    expect((value.d as string).length).toBe(MAX_BODY - 8);
    expect(state.released).toBe(true);
  });

  it("rejects a body one byte over MAX_BODY and releases the stream", async () => {
    const { request, state } = mockUpload(jsonUpload(MAX_BODY + 1, 1024 * 1024));

    await expect(body(request)).rejects.toThrow("Request is too large");
    expect(state.released).toBe(true);
  });

  it("gives a full MAX_BODY upload at a slow remote rate enough receive time", () => {
    // The receive deadline must stay finite (stalled clients release their sockets) and must
    // cover MAX_BODY at the slowest rate the remote link is expected to sustain (~100 KiB/s).
    const slowestRateBytesPerSecond = 100 * 1024;
    const seconds = REQUEST_RECEIVE_TIMEOUT_MS / 1000;

    expect(Number.isFinite(REQUEST_RECEIVE_TIMEOUT_MS)).toBe(true);
    expect(MAX_BODY / slowestRateBytesPerSecond).toBeLessThanOrEqual(seconds);
  });
});

describe("boundRequestReceive", () => {
  function mockRequest(complete: boolean) {
    return { complete, destroy: vi.fn() } as unknown as IncomingMessage & {
      destroy: ReturnType<typeof vi.fn>;
    };
  }

  it("cuts an incomplete request once the unauthenticated budget passes", () => {
    vi.useFakeTimers();
    try {
      const request = mockRequest(false);
      boundRequestReceive(request);

      vi.advanceTimersByTime(UNAUTHENTICATED_RECEIVE_TIMEOUT_MS - 1);
      expect(request.destroy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(request.destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never cuts a request that is already fully received", () => {
    vi.useFakeTimers();
    try {
      const request = mockRequest(true);
      boundRequestReceive(request);

      vi.advanceTimersByTime(REQUEST_RECEIVE_TIMEOUT_MS);
      expect(request.destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an accepted RPC upload keep the full server receive window", () => {
    vi.useFakeTimers();
    try {
      const request = mockRequest(false);
      const disarm = boundRequestReceive(request);

      // Credential accepted before the body read: the short window no longer applies.
      disarm();
      vi.advanceTimersByTime(REQUEST_RECEIVE_TIMEOUT_MS);
      expect(request.destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the unauthenticated budget strictly shorter than the upload window", () => {
    expect(UNAUTHENTICATED_RECEIVE_TIMEOUT_MS).toBeLessThan(REQUEST_RECEIVE_TIMEOUT_MS);
  });
});
