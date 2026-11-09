import { describe, expect, it, vi } from "vitest";
import { OperationDeadlines } from "./operationDeadlines";
import type { RuntimeClock } from "./ports";

class Clock implements RuntimeClock {
  time = 100;
  readonly timers = new Map<object, { at: number; run: () => void }>();
  now = () => this.time;
  schedule(delay: number, run: () => void): () => void {
    const key = {};
    this.timers.set(key, { at: this.time + delay, run });
    return () => {
      this.timers.delete(key);
    };
  }
  advance(ms: number): void {
    this.time += ms;
    for (const [key, timer] of this.timers)
      if (timer.at <= this.time) {
        this.timers.delete(key);
        timer.run();
      }
  }
}

describe("operation deadlines", () => {
  it("expires a stuck query without losing a healthy connection's next request", async () => {
    const clock = new Clock();
    const ledger = new OperationDeadlines(clock, "window-a", 1);
    const cancel = vi.fn();
    const stuck = ledger.begin({
      kind: "query",
      generation: 1,
      timeoutMs: 12_000,
      cancelQuery: cancel,
    });
    expect(() => ledger.begin({ kind: "query", generation: 1, timeoutMs: 10 })).toThrow(/limit/);
    clock.advance(12_000);
    expect(await stuck.result).toEqual({ status: "timed-out", deadlineAt: 12_100 });
    expect(cancel).toHaveBeenCalledOnce();
    const next = ledger.begin({ kind: "query", generation: 1, timeoutMs: 10 });
    expect(ledger.complete(next.requestId, 1, { ready: true })).toBe(true);
    expect(await next.result).toEqual({ status: "completed", value: { ready: true } });
    expect(ledger.size).toBe(0);
    expect(clock.timers.size).toBe(0);
  });

  it("retains durable identity after a mutation timeout and ignores its late result", async () => {
    const clock = new Clock();
    const ledger = new OperationDeadlines(clock, "window-a");
    const turn = ledger.begin({
      kind: "mutation",
      generation: 3,
      timeoutMs: 100,
      commandId: "send-7",
    });
    clock.advance(100);
    expect(await turn.result).toEqual({
      status: "uncertain",
      commandId: "send-7",
      reason: "timeout",
    });
    expect(ledger.complete(turn.requestId, 3, { accepted: true })).toBe(false);
    const status = ledger.begin({ kind: "query", generation: 4, timeoutMs: 100 });
    expect(status.requestId).not.toBe(turn.requestId);
    expect(ledger.complete(status.requestId, 4, { commandId: "send-7", accepted: true })).toBe(
      true,
    );
    expect(await status.result).toMatchObject({ status: "completed" });
  });

  it("enforces an elapsed deadline even before the timer callback gets event-loop time", async () => {
    const clock = new Clock();
    const ledger = new OperationDeadlines(clock, "window-a");
    const read = ledger.begin({ kind: "query", generation: 1, timeoutMs: 10 });
    const write = ledger.begin({
      kind: "mutation",
      generation: 1,
      timeoutMs: 10,
      commandId: "send-8",
    });
    clock.time += 11;
    expect(ledger.complete(read.requestId, 1, "too late")).toBe(false);
    expect(ledger.fail(write.requestId, 1, "too late")).toBe(false);
    expect(await read.result).toMatchObject({ status: "timed-out" });
    expect(await write.result).toEqual({
      status: "uncertain",
      commandId: "send-8",
      reason: "timeout",
    });
    expect(clock.timers.size).toBe(0);
  });

  it("cancels only the wait for a mutation while query cancellation is propagated once", async () => {
    const clock = new Clock();
    const ledger = new OperationDeadlines(clock, "window-a");
    const cancelQuery = vi.fn();
    const read = ledger.begin({ kind: "query", generation: 1, timeoutMs: 100, cancelQuery });
    const write = ledger.begin({
      kind: "mutation",
      generation: 1,
      timeoutMs: 100,
      commandId: "write-1",
    });
    expect(read.cancel()).toBe(true);
    expect(read.cancel()).toBe(false);
    expect(write.cancel()).toBe(true);
    expect(await read.result).toEqual({ status: "cancelled", reason: "cancelled" });
    expect(await write.result).toEqual({
      status: "uncertain",
      commandId: "write-1",
      reason: "cancelled",
    });
    expect(cancelQuery).toHaveBeenCalledOnce();
    expect(clock.timers.size).toBe(0);
  });

  it("fences a lost generation without interrupting a replacement attempt", async () => {
    const ledger = new OperationDeadlines(new Clock(), "window-a");
    const old = ledger.begin({
      kind: "mutation",
      generation: 1,
      timeoutMs: 100,
      commandId: "send-1",
    });
    const current = ledger.begin({ kind: "query", generation: 2, timeoutMs: 100 });
    ledger.disconnect(1);
    expect(await old.result).toEqual({
      status: "uncertain",
      commandId: "send-1",
      reason: "disconnected",
    });
    expect(ledger.complete(current.requestId, 1, "stale")).toBe(false);
    expect(ledger.complete(current.requestId, 2, "current")).toBe(true);
    expect(await current.result).toEqual({ status: "completed", value: "current" });
  });

  it("settles pending work on disposal without reusing request IDs", async () => {
    const clock = new Clock();
    const ledger = new OperationDeadlines(clock, "window-a");
    const first = ledger.begin({ kind: "query", generation: 1, timeoutMs: 100 });
    ledger.fail(first.requestId, 1, "denied");
    const second = ledger.begin({
      kind: "mutation",
      generation: 1,
      timeoutMs: 100,
      commandId: "send-2",
    });
    expect(second.requestId).not.toBe(first.requestId);
    ledger.dispose();
    ledger.dispose();
    expect(await first.result).toEqual({ status: "failed", error: "denied" });
    expect(await second.result).toEqual({
      status: "uncertain",
      commandId: "send-2",
      reason: "disposed",
    });
    expect(clock.timers.size).toBe(0);
    expect(() => ledger.begin({ kind: "query", generation: 2, timeoutMs: 100 })).toThrow(
      /disposed/,
    );
  });

  it("cleans up synchronous timer expiry and accepts a fractional monotonic clock", async () => {
    const release = vi.fn();
    const ledger = new OperationDeadlines(
      {
        now: () => 10.5,
        schedule: (_, run) => {
          run();
          return release;
        },
      },
      "window-a",
    );
    const read = ledger.begin({ kind: "query", generation: 1, timeoutMs: 10 });
    expect(await read.result).toEqual({ status: "timed-out", deadlineAt: 20.5 });
    expect(release).toHaveBeenCalledOnce();
    expect(ledger.size).toBe(0);
  });
});
