// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runThemeTransition } from "./themeTransition";

const motion = vi.hoisted(() => vi.fn(() => true));
vi.mock("./decorativeMotion", () => ({ decorativeMotionEnabled: motion }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("theme crossfade", () => {
  beforeEach(() => {
    motion.mockReturnValue(true);
    vi.stubGlobal("document", {
      documentElement: document.documentElement,
      startViewTransition: undefined,
    });
    runThemeTransition(() => {}, false);
  });
  afterEach(() => {
    runThemeTransition(() => {}, false);
    vi.unstubAllGlobals();
  });

  it("applies immediately without snapshot support", () => {
    const update = vi.fn();
    runThemeTransition(update, true);
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.themeTransition).toBeUndefined();
  });

  it.each(["motion disabled", "unchanged scheme"])("avoids snapshots for %s", (reason) => {
    const start = vi.fn();
    document.startViewTransition = start;
    motion.mockReturnValue(reason !== "motion disabled");
    const update = vi.fn();
    runThemeTransition(update, reason !== "unchanged scheme");
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it("only applies the latest choice when snapshots overlap", async () => {
    const callbacks: (() => void)[] = [];
    const finishes = [deferred(), deferred()];
    const skips = [vi.fn(), vi.fn()];
    document.startViewTransition = vi.fn((callback) => {
      const index = callbacks.length;
      callbacks.push(callback as () => void);
      return {
        ready: Promise.resolve(),
        finished: finishes[index].promise,
        skipTransition: skips[index],
      } as unknown as ViewTransition;
    });
    const old = vi.fn();
    const latest = vi.fn();
    runThemeTransition(old, true);
    runThemeTransition(latest, true);
    callbacks[0]();
    callbacks[1]();
    expect(skips[0]).toHaveBeenCalledOnce();
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    finishes[0].resolve();
    await vi.waitFor(() => expect(document.documentElement.dataset.themeTransition).toBe("fade"));
    finishes[1].resolve();
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.themeTransition).toBeUndefined(),
    );
  });

  it("applies the choice if snapshot creation throws", () => {
    document.startViewTransition = vi.fn(() => {
      throw new Error("unavailable");
    });
    const update = vi.fn();
    runThemeTransition(update, true);
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.themeTransition).toBeUndefined();
  });

  it("recovers when a skipped snapshot rejects before updating", async () => {
    document.startViewTransition = vi.fn(
      () =>
        ({
          ready: Promise.reject(new Error("skipped")),
          finished: Promise.reject(new Error("skipped")),
          skipTransition: vi.fn(),
        }) as unknown as ViewTransition,
    );
    const update = vi.fn();
    runThemeTransition(update, true);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(document.documentElement.dataset.themeTransition).toBeUndefined();
  });
});
