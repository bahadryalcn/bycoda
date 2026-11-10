import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserScreencast, browserFrameCursor } from "./browser-screencast";

function fakePage() {
  let listener: ((frame: { data: string; sessionId: number }) => void) | undefined;
  const session = {
    send: vi.fn(async (_method: string, _params?: Record<string, unknown>) => undefined),
    on: (_event: string, callback: typeof listener) => {
      listener = callback;
    },
    detach: vi.fn(async () => undefined),
  };
  const newCDPSession = vi.fn(async () => session);
  return {
    page: { context: () => ({ newCDPSession }) },
    session,
    newCDPSession,
    paint: (data: string) => listener?.({ data, sessionId: 7 }),
  };
}

describe("BrowserScreencast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds a read until the page repaints and acknowledges every frame", async () => {
    const { page, session, paint } = fakePage();
    const cast = new BrowserScreencast(() => ({ stamp: "doc", width: 1280, height: 720 }));
    const first = cast.next(page, 0, 1000);
    await vi.advanceTimersByTimeAsync(0);
    paint("AAAA");
    const frame = await first;
    expect(frame).toMatchObject({ data: "AAAA", width: 1280, height: 720 });
    expect(session.send).toHaveBeenCalledWith("Page.screencastFrameAck", { sessionId: 7 });

    const second = cast.next(page, frame!.sequence, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBeUndefined();

    paint("BBBB");
    expect((await cast.next(page, frame!.sequence, 0))?.data).toBe("BBBB");
    await cast.stop();
  });

  it("never returns a picture painted for an earlier document", async () => {
    const { page, session, newCDPSession, paint } = fakePage();
    let stamp = "old";
    const cast = new BrowserScreencast(() => ({ stamp, width: 800, height: 600 }));
    const first = cast.next(page, 0, 1000);
    await vi.advanceTimersByTimeAsync(0);
    paint("AAAA");
    await first;
    stamp = "new";
    expect(await cast.next(page, 0, 0)).toBeUndefined();
    // The stale cast is dropped so the next read starts with a fresh first picture.
    expect(session.detach).toHaveBeenCalledTimes(1);
    const again = cast.next(page, 0, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(newCDPSession).toHaveBeenCalledTimes(2);
    paint("CCCC");
    expect((await again)?.stamp).toBe("new");
    await cast.stop();
  });

  it("drops oversized frames and stops when nobody reads", async () => {
    const { page, session, paint } = fakePage();
    const cast = new BrowserScreencast(() => ({ stamp: "doc", width: 1, height: 1 }), 3);
    const read = cast.next(page, 0, 100);
    await vi.advanceTimersByTimeAsync(0);
    paint("AAAAAAAA");
    await vi.advanceTimersByTimeAsync(100);
    expect(await read).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(session.detach).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed start", async () => {
    const { page, newCDPSession } = fakePage();
    newCDPSession.mockRejectedValueOnce(new Error("target closed"));
    const cast = new BrowserScreencast(() => ({ stamp: "doc", width: 1, height: 1 }));
    await expect(cast.next(page, 0, 0)).rejects.toThrow("target closed");
    await expect(cast.next(page, 0, 0)).resolves.toBeUndefined();
    await cast.stop();
  });

  it("bounds the cursor and wait", () => {
    expect(browserFrameCursor(0, undefined)).toEqual({ after: 0, waitMs: 1000 });
    expect(() => browserFrameCursor(-1, 0)).toThrow("Invalid browser frame cursor");
    expect(() => browserFrameCursor("1", 0)).toThrow("Invalid browser frame cursor");
    expect(() => browserFrameCursor(1, 60_000)).toThrow("Invalid browser frame wait");
  });
});
